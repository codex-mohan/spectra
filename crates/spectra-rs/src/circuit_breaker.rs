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
