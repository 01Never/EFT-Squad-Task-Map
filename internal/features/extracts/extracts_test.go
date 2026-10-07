package extracts

import (
	"bytes"
	"encoding/json"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"squadtaskmap/internal/openai"
)

// fakeModel answers /responses with whatever answer it holds and counts the calls.
type fakeModel struct {
	calls    atomic.Int32
	mutex    sync.Mutex
	answer   string
	release  chan struct{} // when set, each answer waits for a value here
	lastBody map[string]any
}

func (model *fakeModel) setAnswer(answer string) {
	model.mutex.Lock()
	defer model.mutex.Unlock()
	model.answer = answer
}

func (model *fakeModel) ServeHTTP(writer http.ResponseWriter, request *http.Request) {
	model.calls.Add(1)
	var body map[string]any
	_ = json.NewDecoder(request.Body).Decode(&body)
	model.mutex.Lock()
	model.lastBody = body
	answer, release := model.answer, model.release
	model.mutex.Unlock()
	if release != nil {
		<-release
	}
	response := map[string]any{"output": []any{map[string]any{"type": "message", "content": []any{
		map[string]any{"type": "output_text", "text": answer},
	}}}}
	_ = json.NewEncoder(writer).Encode(response)
}

type fakeFolder struct{ data []byte }

func (folder fakeFolder) ReadFile(string) ([]byte, error) { return folder.data, nil }

const crossroadsList = `{"visible": true, "extracts": [{"name": "Crossroads", "note": "Requires paracord"}, {"name": "Mystery Gate", "note": null}]}`
const noListVisible = `{"visible": false, "extracts": []}`

// readerFixture is a reader wired to a fake model, with the results it delivered.
type readerFixture struct {
	reader  *Reader
	model   *fakeModel
	config  Config
	results chan Result
}

func newFixture(t *testing.T, mapKey *string) *readerFixture {
	t.Helper()
	model := &fakeModel{answer: crossroadsList}
	server := httptest.NewServer(model)
	t.Cleanup(server.Close)
	t.Setenv("STM_OPENAI_API", server.URL)

	picture := image.NewRGBA(image.Rect(0, 0, 100, 60))
	var encoded bytes.Buffer
	if err := png.Encode(&encoded, picture); err != nil {
		t.Fatal(err)
	}
	fixture := &readerFixture{model: model, config: Config{Key: "sk-test", Enabled: true}, results: make(chan Result, 10)}
	fixture.reader = New(
		fakeFolder{encoded.Bytes()}, openai.NewClient("test"),
		func() Config { return fixture.config },
		func() *string { return mapKey },
		func(string) []string { return []string{"Crossroads", "ZB-1011"} },
		func(result Result) { fixture.results <- result },
	)
	return fixture
}

func (fixture *readerFixture) waitForResult(t *testing.T) Result {
	t.Helper()
	select {
	case result := <-fixture.results:
		return result
	case <-time.After(3 * time.Second):
		t.Fatal("no result was delivered")
		return Result{}
	}
}

// settle waits until no read is running (so the next screenshot can be tried or the counts are final).
func (fixture *readerFixture) settle(t *testing.T) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		fixture.reader.mutex.Lock()
		reading := fixture.reader.isReading
		fixture.reader.mutex.Unlock()
		if !reading {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatal("the read never finished")
}

func (fixture *readerFixture) shot(t *testing.T) {
	t.Helper()
	fixture.reader.OnGPSShot("2026-10-01[14-05]_1, 2, 3_0, 0, 0, 1 (0).png")
	fixture.settle(t)
}

func TestTheFirstScreenshotOfARaidIsReadAndItsExtractsAreMatchedToTheMap(t *testing.T) {
	customs := "customs"
	fixture := newFixture(t, &customs)
	fixture.reader.RaidStarted()
	fixture.reader.OnGPSShot("shot.png")

	result := fixture.waitForResult(t)
	if result.Map == nil || *result.Map != "customs" {
		t.Errorf("map = %v, want customs", result.Map)
	}
	if len(result.Marked) != 1 || result.Marked[0].Name != "Crossroads" || *result.Marked[0].Note != "Requires paracord" {
		t.Errorf("marked = %+v, want Crossroads with its note", result.Marked)
	}
	if len(result.Unknown) != 1 || result.Unknown[0] != "Mystery Gate" {
		t.Errorf("unknown = %v, want [Mystery Gate]", result.Unknown)
	}
}

func TestTheRequestAsksForAStrictSchemaLowReasoningAndAShrunkJPEG(t *testing.T) {
	customs := "customs"
	fixture := newFixture(t, &customs)
	fixture.config.Model = "gpt-5.4-mini"
	fixture.reader.RaidStarted()
	fixture.shot(t)

	body := fixture.model.lastBody
	format := body["text"].(map[string]any)["format"].(map[string]any)
	if format["strict"] != true || format["type"] != "json_schema" {
		t.Errorf("format = %v, want a strict json_schema", format)
	}
	if effort := body["reasoning"].(map[string]any)["effort"]; effort != "low" {
		t.Errorf("reasoning effort = %v, want low", effort)
	}
	content := body["input"].([]any)[0].(map[string]any)["content"].([]any)
	imageURL := content[1].(map[string]any)["image_url"].(string)
	if !strings.HasPrefix(imageURL, "data:image/jpeg;base64,") {
		t.Errorf("the picture is sent as %.30s…, want a JPEG data URL", imageURL)
	}
}

func TestOnlyOneModelCallIsMadeOnceAListWasFound(t *testing.T) {
	customs := "customs"
	fixture := newFixture(t, &customs)
	fixture.reader.RaidStarted()
	fixture.shot(t)
	fixture.shot(t)
	fixture.shot(t)
	if calls := fixture.model.calls.Load(); calls != 1 {
		t.Errorf("model calls = %d, want 1", calls)
	}
}

func TestScreenshotsWithoutAListAreTriedUpToThreeTimesThenLeftAlone(t *testing.T) {
	customs := "customs"
	fixture := newFixture(t, &customs)
	fixture.model.setAnswer(noListVisible)
	fixture.reader.RaidStarted()
	for i := 0; i < 5; i++ {
		fixture.shot(t)
	}
	if calls := fixture.model.calls.Load(); calls != MaxScreenshotsPerRaid {
		t.Errorf("model calls = %d, want %d", calls, MaxScreenshotsPerRaid)
	}
	if len(fixture.results) != 0 {
		t.Error("nothing should be delivered when no list was visible")
	}
}

func TestALaterScreenshotThatShowsTheListIsUsed(t *testing.T) {
	customs := "customs"
	fixture := newFixture(t, &customs)
	fixture.model.setAnswer(noListVisible)
	fixture.reader.RaidStarted()
	fixture.shot(t)
	fixture.model.setAnswer(crossroadsList)
	fixture.shot(t)
	fixture.waitForResult(t)
	if calls := fixture.model.calls.Load(); calls != 2 {
		t.Errorf("model calls = %d, want 2", calls)
	}
}

func TestNothingIsSentWithoutAKeyOrWithTheSettingOff(t *testing.T) {
	customs := "customs"
	fixture := newFixture(t, &customs)
	fixture.reader.RaidStarted()

	fixture.config = Config{Key: "sk-test", Enabled: false}
	fixture.shot(t)
	fixture.config = Config{Key: "", Enabled: true}
	fixture.shot(t)

	if calls := fixture.model.calls.Load(); calls != 0 {
		t.Errorf("model calls = %d, want 0", calls)
	}
}

func TestNothingIsSentOutsideARaid(t *testing.T) {
	customs := "customs"
	fixture := newFixture(t, &customs)
	fixture.shot(t) // no raid started yet
	fixture.reader.RaidStarted()
	fixture.reader.RaidEnded()
	fixture.shot(t)
	if calls := fixture.model.calls.Load(); calls != 0 {
		t.Errorf("model calls = %d, want 0", calls)
	}
}

func TestAnAnswerThatArrivesAfterTheRaidEndedIsDropped(t *testing.T) {
	customs := "customs"
	fixture := newFixture(t, &customs)
	fixture.model.release = make(chan struct{})
	fixture.reader.RaidStarted()
	fixture.reader.OnGPSShot("shot.png")
	fixture.reader.RaidEnded()
	fixture.model.release <- struct{}{}
	fixture.settle(t)
	if len(fixture.results) != 0 {
		t.Error("an answer from the old raid must not be delivered")
	}
}

func TestTheNextRaidReadsAgain(t *testing.T) {
	customs := "customs"
	fixture := newFixture(t, &customs)
	fixture.reader.RaidStarted()
	fixture.shot(t)
	fixture.waitForResult(t)
	fixture.reader.RaidEnded()
	fixture.reader.RaidStarted()
	fixture.shot(t)
	fixture.waitForResult(t)
	if calls := fixture.model.calls.Load(); calls != 2 {
		t.Errorf("model calls = %d, want 2 (one per raid)", calls)
	}
}

func TestWhenTheRaidsMapIsUnknownTheReadNamesAreHandedOnForThePageToMatch(t *testing.T) {
	fixture := newFixture(t, nil)
	fixture.reader.RaidStarted()
	fixture.shot(t)
	result := fixture.waitForResult(t)
	if result.Map != nil || len(result.Read) != 2 || len(result.Marked) != 0 {
		t.Errorf("result = %+v, want no map, the 2 names read and nothing matched", result)
	}
}

func TestABigScreenshotIsShrunkToAJPEGWithinTheLimit(t *testing.T) {
	big := image.NewRGBA(image.Rect(0, 0, 4096, 2304))
	for x := 0; x < 4096; x += 2 {
		for y := 0; y < 2304; y++ {
			big.Set(x, y, color.White)
		}
	}
	var source bytes.Buffer
	if err := png.Encode(&source, big); err != nil {
		t.Fatal(err)
	}
	shrunk, err := ShrinkToJPEG(source.Bytes())
	if err != nil {
		t.Fatal(err)
	}
	decoded, err := jpeg.Decode(bytes.NewReader(shrunk))
	if err != nil {
		t.Fatalf("the result isn't a JPEG: %v", err)
	}
	if bounds := decoded.Bounds(); bounds.Dx() != 2048 || bounds.Dy() != 1152 {
		t.Errorf("size = %d x %d, want 2048 x 1152", bounds.Dx(), bounds.Dy())
	}
}

func TestAScreenshotThatIsNotAPNGOrJPEGIsRefused(t *testing.T) {
	if _, err := ShrinkToJPEG([]byte("BM not really a bitmap")); err != ErrUnsupportedImage {
		t.Errorf("err = %v, want ErrUnsupportedImage", err)
	}
}
