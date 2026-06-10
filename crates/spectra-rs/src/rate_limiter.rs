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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_rate_limit_allows_within_window() {
        let rl = LocalRateLimiter::new(3, Duration::from_secs(60));
        let r1 = rl.check_limit("user1");
        assert!(r1.allowed);
        assert_eq!(r1.remaining, 2);

        let r2 = rl.check_limit("user1");
        assert!(r2.allowed);
        assert_eq!(r2.remaining, 1);

        let r3 = rl.check_limit("user1");
        assert!(r3.allowed);
        assert_eq!(r3.remaining, 0);
    }

    #[test]
    fn test_rate_limit_blocks_exceeded() {
        let rl = LocalRateLimiter::new(1, Duration::from_secs(60));
        assert!(rl.check_limit("user1").allowed);
        assert!(!rl.check_limit("user1").allowed);
        assert_eq!(rl.check_limit("user1").remaining, 0);
    }

    #[test]
    fn test_rate_limit_per_key_isolation() {
        let rl = LocalRateLimiter::new(1, Duration::from_secs(60));
        assert!(rl.check_limit("user_a").allowed);
        assert!(rl.check_limit("user_b").allowed);
        assert!(!rl.check_limit("user_a").allowed);
        assert!(!rl.check_limit("user_b").allowed);
    }

    #[test]
    fn test_default_constructor() {
        let rl = LocalRateLimiter::with_defaults();
        let result = rl.check_limit("test");
        assert!(result.allowed);
    }
}
