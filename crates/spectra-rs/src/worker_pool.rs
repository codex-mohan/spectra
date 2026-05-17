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
