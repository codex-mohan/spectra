use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

#[derive(Debug, Clone)]
pub struct RateLimitResult {
    pub allowed: bool,
    pub remaining: u32,
    pub window_end: Instant,
}

pub trait RateLimiter: Send + Sync {
    fn check_limit(&self, key: &str) -> RateLimitResult;
}

pub struct LocalRateLimiter {
    requests: Mutex<HashMap<String, Vec<Instant>>>,
    max_requests: u32,
    window: Duration,
}

impl LocalRateLimiter {
    pub fn new(max_requests: u32, window: Duration) -> Self {
        Self {
            requests: Mutex::new(HashMap::new()),
            max_requests,
            window,
        }
    }

    pub fn with_defaults() -> Self {
        Self::new(60, Duration::from_secs(60))
    }
}

impl RateLimiter for LocalRateLimiter {
    fn check_limit(&self, key: &str) -> RateLimitResult {
        let now = Instant::now();
        let window_start = now - self.window;

        let mut map = self.requests.lock().unwrap();
        let timestamps = map.entry(key.to_string()).or_default();

        timestamps.retain(|t| *t > window_start);

        let count = timestamps.len() as u32;
        let allowed = count < self.max_requests;

        if allowed {
            timestamps.push(now);
        }

        RateLimitResult {
            allowed,
            remaining: self.max_requests.saturating_sub(count + 1),
            window_end: now + self.window,
        }
    }
}
