use std::sync::Mutex;
use std::time::Instant;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CircuitState {
    Closed,
    Open,
    HalfOpen,
}

impl CircuitState {
    pub fn as_str(&self) -> &'static str {
        match self {
            CircuitState::Closed => "CLOSED",
            CircuitState::Open => "OPEN",
            CircuitState::HalfOpen => "HALF_OPEN",
        }
    }
}

impl std::fmt::Display for CircuitState {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}", self.as_str())
    }
}

#[derive(Debug, Clone)]
pub struct CircuitBreakerConfig {
    pub failure_threshold: u32,
    pub reset_timeout: std::time::Duration,
    pub half_open_max_requests: u32,
}

impl Default for CircuitBreakerConfig {
    fn default() -> Self {
        Self {
            failure_threshold: 5,
            reset_timeout: std::time::Duration::from_secs(30),
            half_open_max_requests: 3,
        }
    }
}

struct CircuitBreakerInner {
    state: CircuitState,
    failure_count: u32,
    last_failure_time: Option<Instant>,
    half_open_count: u32,
}

pub struct CircuitBreaker {
    inner: Mutex<CircuitBreakerInner>,
    config: CircuitBreakerConfig,
}

impl CircuitBreaker {
    pub fn new() -> Self {
        Self::with_config(CircuitBreakerConfig::default())
    }

    pub fn with_config(config: CircuitBreakerConfig) -> Self {
        Self {
            inner: Mutex::new(CircuitBreakerInner {
                state: CircuitState::Closed,
                failure_count: 0,
                last_failure_time: None,
                half_open_count: 0,
            }),
            config,
        }
    }

    pub fn state(&self) -> CircuitState {
        let mut inner = self.inner.lock().unwrap();
        Self::transition_if_needed_inner(&mut inner, &self.config);
        inner.state
    }

    pub fn failure_count(&self) -> u32 {
        let inner = self.inner.lock().unwrap();
        inner.failure_count
    }

    pub async fn call<T, E, F, Fut>(&self, f: F) -> Result<T, CircuitBreakerError<E>>
    where
        F: FnOnce() -> Fut,
        Fut: std::future::Future<Output = Result<T, E>>,
    {
        {
            let mut inner = self.inner.lock().unwrap();
            Self::transition_if_needed_inner(&mut inner, &self.config);

            match inner.state {
                CircuitState::Open => {
                    let ago = inner
                        .last_failure_time
                        .map(|t| t.elapsed().as_millis() as u64)
                        .unwrap_or(0);
                    return Err(CircuitBreakerError::Open {
                        last_failure_ago_ms: ago,
                    });
                }
                CircuitState::HalfOpen
                    if inner.half_open_count >= self.config.half_open_max_requests =>
                {
                    return Err(CircuitBreakerError::HalfOpenLimitReached {
                        max: self.config.half_open_max_requests,
                    });
                }
                _ => {}
            }

            if inner.state == CircuitState::HalfOpen {
                inner.half_open_count += 1;
            }
        }

        match f().await {
            Ok(val) => {
                self.record_success();
                Ok(val)
            }
            Err(err) => {
                self.record_failure();
                Err(CircuitBreakerError::Inner(err))
            }
        }
    }

    pub fn record_success(&self) {
        let mut inner = self.inner.lock().unwrap();
        inner.failure_count = 0;
        inner.half_open_count = 0;
        inner.state = CircuitState::Closed;
    }

    pub fn record_failure(&self) {
        let mut inner = self.inner.lock().unwrap();
        inner.failure_count += 1;
        inner.last_failure_time = Some(Instant::now());

        match inner.state {
            CircuitState::Closed if inner.failure_count >= self.config.failure_threshold => {
                inner.state = CircuitState::Open;
            }
            CircuitState::HalfOpen => {
                inner.state = CircuitState::Open;
                inner.half_open_count = 0;
            }
            _ => {}
        }
    }

    pub fn config(&self) -> &CircuitBreakerConfig {
        &self.config
    }

    fn transition_if_needed_inner(
        inner: &mut CircuitBreakerInner,
        config: &CircuitBreakerConfig,
    ) {
        if inner.state == CircuitState::Open {
            if let Some(last_failure) = inner.last_failure_time {
                if last_failure.elapsed() >= config.reset_timeout {
                    inner.state = CircuitState::HalfOpen;
                    inner.half_open_count = 0;
                }
            }
        }
    }
}

impl Default for CircuitBreaker {
    fn default() -> Self {
        Self::new()
    }
}

#[derive(Debug)]
pub enum CircuitBreakerError<E = Box<dyn std::error::Error + Send + Sync>> {
    Open {
        last_failure_ago_ms: u64,
    },
    HalfOpenLimitReached {
        max: u32,
    },
    Inner(E),
}

impl<E: std::fmt::Display> std::fmt::Display for CircuitBreakerError<E> {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            CircuitBreakerError::Open {
                last_failure_ago_ms,
            } => {
                write!(
                    f,
                    "Circuit breaker is OPEN (last failure {}ms ago)",
                    last_failure_ago_ms
                )
            }
            CircuitBreakerError::HalfOpenLimitReached { max } => {
                write!(
                    f,
                    "Circuit breaker HALF_OPEN limit reached ({max} max probe requests)"
                )
            }
            CircuitBreakerError::Inner(err) => {
                write!(f, "Circuit breaker execution failed: {err}")
            }
        }
    }
}

impl<E: std::error::Error + 'static> std::error::Error for CircuitBreakerError<E> {
    fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
        match self {
            CircuitBreakerError::Inner(err) => Some(err),
            _ => None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_circuit_breaker_starts_closed() {
        let cb = CircuitBreaker::new();
        assert_eq!(cb.state(), CircuitState::Closed);
        assert_eq!(cb.failure_count(), 0);
    }

    #[test]
    fn test_default_config_values() {
        let config = CircuitBreakerConfig::default();
        assert_eq!(config.failure_threshold, 5);
        assert_eq!(config.reset_timeout, std::time::Duration::from_secs(30));
        assert_eq!(config.half_open_max_requests, 3);
    }

    #[test]
    fn test_custom_config() {
        let config = CircuitBreakerConfig {
            failure_threshold: 3,
            reset_timeout: std::time::Duration::from_millis(100),
            half_open_max_requests: 1,
        };
        assert_eq!(config.failure_threshold, 3);
        assert_eq!(config.reset_timeout.as_millis(), 100);
        assert_eq!(config.half_open_max_requests, 1);
    }

    #[tokio::test]
    async fn test_successful_call_keeps_closed() {
        let cb = CircuitBreaker::new();
        let result = cb.call(|| async { Ok::<_, String>("ok") }).await;
        assert!(result.is_ok());
        assert_eq!(cb.state(), CircuitState::Closed);
    }

    #[tokio::test]
    async fn test_failures_trip_breaker_to_open() {
        let config = CircuitBreakerConfig {
            failure_threshold: 2,
            reset_timeout: std::time::Duration::from_secs(60),
            half_open_max_requests: 1,
        };
        let cb = CircuitBreaker::with_config(config);

        let r1 = cb.call(|| async { Err::<String, String>("fail1".to_string()) }).await;
        assert!(r1.is_err());

        let r2 = cb.call(|| async { Err::<String, String>("fail2".to_string()) }).await;
        assert!(r2.is_err());

        assert_eq!(cb.state(), CircuitState::Open);
    }

    #[tokio::test]
    async fn test_open_breaker_rejects_calls() {
        let config = CircuitBreakerConfig {
            failure_threshold: 1,
            reset_timeout: std::time::Duration::from_secs(60),
            half_open_max_requests: 1,
        };
        let cb = CircuitBreaker::with_config(config);

        let _ = cb.call(|| async { Err::<String, String>("fail".to_string()) }).await;
        assert_eq!(cb.state(), CircuitState::Open);

        let result: Result<_, CircuitBreakerError<String>> = cb.call(|| async { Ok::<String, String>("should not run".to_string()) }).await;
        assert!(result.is_err());
        match result.unwrap_err() {
            CircuitBreakerError::Open { .. } => {},
            _ => panic!("Expected Open error"),
        }
    }

    #[tokio::test]
    async fn test_breaker_transitions_to_half_open_after_timeout() {
        let config = CircuitBreakerConfig {
            failure_threshold: 1,
            reset_timeout: std::time::Duration::from_millis(10),
            half_open_max_requests: 1,
        };
        let cb = CircuitBreaker::with_config(config);

        let _ = cb.call(|| async { Err::<String, String>("fail".to_string()) }).await;
        assert_eq!(cb.state(), CircuitState::Open);

        tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        assert_eq!(cb.state(), CircuitState::HalfOpen);
    }

    #[tokio::test]
    async fn test_half_open_success_resets_to_closed() {
        let config = CircuitBreakerConfig {
            failure_threshold: 1,
            reset_timeout: std::time::Duration::from_millis(10),
            half_open_max_requests: 1,
        };
        let cb = CircuitBreaker::with_config(config);

        let _ = cb.call(|| async { Err::<String, String>("fail".to_string()) }).await;
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;

        let result: Result<_, CircuitBreakerError<String>> = cb.call(|| async { Ok::<String, String>("recovered".to_string()) }).await;
        assert!(result.is_ok());
        assert_eq!(cb.state(), CircuitState::Closed);
    }

    #[tokio::test]
    async fn test_half_open_failure_goes_back_to_open() {
        let config = CircuitBreakerConfig {
            failure_threshold: 1,
            reset_timeout: std::time::Duration::from_millis(10),
            half_open_max_requests: 1,
        };
        let cb = CircuitBreaker::with_config(config);

        let _ = cb.call(|| async { Err::<String, String>("first fail".to_string()) }).await;
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;

        let _ = cb.call(|| async { Err::<String, String>("probe fail".to_string()) }).await;
        assert_eq!(cb.state(), CircuitState::Open);
    }

    #[tokio::test]
    async fn test_half_open_limit_reached() {
        let config = CircuitBreakerConfig {
            failure_threshold: 1,
            reset_timeout: std::time::Duration::from_millis(10),
            half_open_max_requests: 1,
        };
        let cb = CircuitBreaker::with_config(config);

        let _ = cb.call(|| async { Err::<String, String>("fail".to_string()) }).await;
        tokio::time::sleep(std::time::Duration::from_millis(20)).await;

        let cb = std::sync::Arc::new(cb);
        let cb1 = cb.clone();
        let cb2 = cb.clone();

        let (r1, r2) = tokio::join!(
            cb1.call(|| async {
                tokio::time::sleep(std::time::Duration::from_millis(100)).await;
                Ok::<String, String>("slow".to_string())
            }),
            cb2.call(|| async { Ok::<String, String>("fast".to_string()) }),
        );

        assert!(r1.is_ok());
        assert!(r2.is_err());
        match r2.unwrap_err() {
            CircuitBreakerError::HalfOpenLimitReached { max: 1 } => {},
            _ => panic!("Expected HalfOpenLimitReached"),
        }
    }

    #[test]
    fn test_manual_record_success() {
        let cb = CircuitBreaker::new();
        cb.record_failure();
        cb.record_failure();
        assert_eq!(cb.failure_count(), 2);
        cb.record_success();
        assert_eq!(cb.failure_count(), 0);
    }

    #[test]
    fn test_circuit_state_display() {
        assert_eq!(CircuitState::Closed.to_string(), "CLOSED");
        assert_eq!(CircuitState::Open.to_string(), "OPEN");
        assert_eq!(CircuitState::HalfOpen.to_string(), "HALF_OPEN");
    }

    #[test]
    fn test_error_display() {
        let open_err = CircuitBreakerError::<String>::Open { last_failure_ago_ms: 100 };
        assert!(open_err.to_string().contains("OPEN"));
        assert!(open_err.to_string().contains("100ms"));

        let limit_err = CircuitBreakerError::<String>::HalfOpenLimitReached { max: 5 };
        assert!(limit_err.to_string().contains("5"));

        let inner_err = CircuitBreakerError::Inner("inner error".to_string());
        assert!(inner_err.to_string().contains("inner error"));
    }
}
