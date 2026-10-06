package aicategorize

import (
	"crypto/rand"
	"math/big"
	"sync"
	"time"
)

// A categorize request can take a minute, so it runs as a job the page asks about
// (GET /api/ai/job/<id>; the only polling the page does, and only while a job runs).
// Jobs live in memory: restarting the app drops a running job. When a new job starts, every job
// that started more than an hour ago is forgotten (as v2 did).
const jobLifetime = time.Hour

// A whole job (wiki pages + model rounds) gives up after this long, so the page never waits forever.
const JobTimeout = 10 * time.Minute

// Job is a running or finished categorize request, as the page sees it.
type Job struct {
	Status string  `json:"status"` // "running", "done" or "error"
	Log    string  `json:"log"`    // the latest progress message
	Result *Result `json:"result"`
	Error  *string `json:"error"`
	T      float64 `json:"t"` // when it started, ms since 1970
}

// Jobs keeps the jobs.
type Jobs struct {
	mutex sync.Mutex
	jobs  map[string]*Job
}

// NewJobs makes an empty job list.
func NewJobs() *Jobs { return &Jobs{jobs: map[string]*Job{}} }

// Start registers a new job and runs work in the background. work reports progress through log.
//
// Goroutine: one per job; ends when work returns.
func (jobs *Jobs) Start(work func(log func(string)) (Result, error)) string {
	id := randomID()
	job := &Job{Status: "running", Log: "Starting…", T: float64(time.Now().UnixMilli())}
	jobs.mutex.Lock()
	jobs.jobs[id] = job
	for otherID, other := range jobs.jobs {
		if float64(time.Now().UnixMilli())-other.T > float64(jobLifetime.Milliseconds()) {
			delete(jobs.jobs, otherID)
		}
	}
	jobs.mutex.Unlock()

	go func() {
		result, err := work(func(message string) {
			jobs.mutex.Lock()
			job.Log = message
			jobs.mutex.Unlock()
		})
		jobs.mutex.Lock()
		defer jobs.mutex.Unlock()
		if err != nil {
			message := err.Error()
			job.Status, job.Error = "error", &message
			return
		}
		job.Status, job.Result = "done", &result
	}()
	return id
}

// Get returns a copy of a job.
func (jobs *Jobs) Get(id string) (*Job, bool) {
	jobs.mutex.Lock()
	defer jobs.mutex.Unlock()
	job, found := jobs.jobs[id]
	if !found {
		return nil, false
	}
	copied := *job
	return &copied, true
}

// randomID is 8 lower-case letters and digits, like v2's job ids.
func randomID() string {
	const alphabet = "0123456789abcdefghijklmnopqrstuvwxyz"
	id := make([]byte, 8)
	for i := range id {
		n, _ := rand.Int(rand.Reader, big.NewInt(int64(len(alphabet))))
		id[i] = alphabet[n.Int64()]
	}
	return string(id)
}
