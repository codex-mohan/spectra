use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Instant;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum HealthStatus {
    Healthy,
    Degraded,
    Unhealthy,
}

impl HealthStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            HealthStatus::Healthy => "healthy",
            HealthStatus::Degraded => "degraded",
            HealthStatus::Unhealthy => "unhealthy",
        }
    }
}

#[derive(Debug, Clone)]
pub struct HealthCheckResult {
    pub status: HealthStatus,
    pub message: Option<String>,
}

#[derive(Debug, Clone)]
pub struct HealthReport {
    pub status: HealthStatus,
    pub uptime_secs: u64,
    pub checks: HashMap<String, HealthCheckResult>,
}

type CheckFn = Box<dyn Fn() -> HealthCheckResult + Send + Sync>;

pub struct HealthProbe {
    start_time: Instant,
    checks: Mutex<HashMap<String, CheckFn>>,
}

impl HealthProbe {
    pub fn new() -> Self {
        Self {
            start_time: Instant::now(),
            checks: Mutex::new(HashMap::new()),
        }
    }

    pub fn register<F>(&self, name: impl Into<String>, check: F)
    where
        F: Fn() -> HealthCheckResult + Send + Sync + 'static,
    {
        let mut checks = self.checks.lock().unwrap();
        checks.insert(name.into(), Box::new(check));
    }

    pub fn health(&self) -> HealthReport {
        let mut report = HealthReport {
            status: HealthStatus::Healthy,
            uptime_secs: self.start_time.elapsed().as_secs(),
            checks: HashMap::new(),
        };

        let checks = self.checks.lock().unwrap();
        for (name, check) in checks.iter() {
            let result = check();
            if result.status != HealthStatus::Healthy {
                report.status = HealthStatus::Degraded;
            }
            report.checks.insert(name.clone(), result);
        }

        report
    }
}

impl Default for HealthProbe {
    fn default() -> Self {
        Self::new()
    }
}
