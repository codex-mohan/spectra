use std::sync::atomic::{AtomicU64, Ordering};

#[derive(Debug, Clone)]
pub struct WorkerJob {
    pub id: String,
    pub input: String,
}

#[derive(Debug, Clone)]
pub struct WorkerResult {
    pub success: bool,
    pub output: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug)]
pub struct SequentialWorkerPool {
    next_id: AtomicU64,
    jobs: Vec<WorkerJob>,
    processing: bool,
    stopped: bool,
}

impl SequentialWorkerPool {
    pub fn new() -> Self {
        Self {
            next_id: AtomicU64::new(1),
            jobs: Vec::new(),
            processing: false,
            stopped: false,
        }
    }

    pub fn enqueue(&mut self, input: impl Into<String>) -> String {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed).to_string();
        self.jobs.push(WorkerJob {
            id: id.clone(),
            input: input.into(),
        });
        id
    }

    pub async fn process<F, Fut>(&mut self, handler: F)
    where
        F: Fn(WorkerJob) -> Fut + Send + Sync + 'static,
        Fut: std::future::Future<Output = WorkerResult> + Send,
    {
        if self.processing {
            return;
        }
        self.processing = true;

        while !self.stopped {
            let job = self.jobs.first().cloned();
            match job {
                Some(job) => {
                    self.jobs.remove(0);
                    handler(job).await;
                }
                None => break,
            }
        }

        self.processing = false;
    }

    pub fn stop(&mut self) {
        self.stopped = true;
    }

    pub fn remaining(&self) -> usize {
        self.jobs.len()
    }

    pub fn is_processing(&self) -> bool {
        self.processing
    }
}

impl Default for SequentialWorkerPool {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_enqueue_returns_incrementing_ids() {
        let mut pool = SequentialWorkerPool::new();
        let id1 = pool.enqueue("job1");
        let id2 = pool.enqueue("job2");
        let id3 = pool.enqueue("job3");
        assert_eq!(id1, "1");
        assert_eq!(id2, "2");
        assert_eq!(id3, "3");
    }

    #[test]
    fn test_remaining_counts_jobs() {
        let mut pool = SequentialWorkerPool::new();
        assert_eq!(pool.remaining(), 0);
        pool.enqueue("a");
        pool.enqueue("b");
        assert_eq!(pool.remaining(), 2);
    }

    #[tokio::test]
    async fn test_process_executes_jobs() {
        let mut pool = SequentialWorkerPool::new();
        pool.enqueue("hello");

        let processed = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
        let processed_clone = processed.clone();

        pool.process(move |job: WorkerJob| {
            let p = processed_clone.clone();
            async move {
                p.lock().unwrap().push(job.input.clone());
                WorkerResult {
                    success: true,
                    output: Some(job.input),
                    error: None,
                }
            }
        })
        .await;

        assert_eq!(pool.remaining(), 0);
        let results = processed.lock().unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0], "hello");
    }

    #[tokio::test]
    async fn test_process_respects_order() {
        let mut pool = SequentialWorkerPool::new();
        pool.enqueue("first");
        pool.enqueue("second");
        pool.enqueue("third");

        let order = std::sync::Arc::new(std::sync::Mutex::new(Vec::new()));
        let order_clone = order.clone();

        pool.process(move |job: WorkerJob| {
            let o = order_clone.clone();
            async move {
                o.lock().unwrap().push(job.input.clone());
                WorkerResult {
                    success: true,
                    output: Some(job.input),
                    error: None,
                }
            }
        })
        .await;

        let results = order.lock().unwrap();
        assert_eq!(*results, vec!["first", "second", "third"]);
    }

    #[test]
    fn test_stop_flag() {
        let mut pool = SequentialWorkerPool::new();
        assert!(!pool.is_processing());
        pool.stop();
    }

    #[tokio::test]
    async fn test_empty_pool_processes_nothing() {
        let mut pool = SequentialWorkerPool::new();
        pool.process(|_| async { unreachable!() }).await;
        assert_eq!(pool.remaining(), 0);
    }
}
