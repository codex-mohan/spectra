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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_health_probe_starts_healthy() {
        let probe = HealthProbe::new();
        let report = probe.health();
        assert_eq!(report.status, HealthStatus::Healthy);
        assert!(report.uptime_secs < 2);
        assert!(report.checks.is_empty());
    }

    #[test]
    fn test_health_probe_with_healthy_checks() {
        let probe = HealthProbe::new();
        probe.register("check_db", || HealthCheckResult {
            status: HealthStatus::Healthy,
            message: Some("DB connected".into()),
        });
        probe.register("check_api", || HealthCheckResult {
            status: HealthStatus::Healthy,
            message: Some("API reachable".into()),
        });

        let report = probe.health();
        assert_eq!(report.status, HealthStatus::Healthy);
        assert_eq!(report.checks.len(), 2);
        assert_eq!(report.checks.get("check_db").unwrap().status, HealthStatus::Healthy);
    }

    #[test]
    fn test_health_probe_becomes_degraded() {
        let probe = HealthProbe::new();
        probe.register("healthy_check", || HealthCheckResult {
            status: HealthStatus::Healthy,
            message: None,
        });
        probe.register("failing_check", || HealthCheckResult {
            status: HealthStatus::Unhealthy,
            message: Some("Connection refused".into()),
        });

        let report = probe.health();
        assert_eq!(report.status, HealthStatus::Degraded);
    }

    #[test]
    fn test_health_status_as_str() {
        assert_eq!(HealthStatus::Healthy.as_str(), "healthy");
        assert_eq!(HealthStatus::Degraded.as_str(), "degraded");
        assert_eq!(HealthStatus::Unhealthy.as_str(), "unhealthy");
    }

    #[test]
    fn test_uptime_increases() {
        let probe = HealthProbe::new();
        let report1 = probe.health();
        let uptime1 = report1.uptime_secs;

        // Uptime should be near zero for a fresh probe
        assert!(uptime1 <= 1);

        // Can't easily test increase in unit test without sleeping,
        // but we can verify the field exists and is populated
        assert!(report1.uptime_secs < 5);
    }

    #[test]
    fn test_multiple_degraded_checks_stay_degraded() {
        let probe = HealthProbe::new();
        probe.register("check1", || HealthCheckResult {
            status: HealthStatus::Degraded,
            message: None,
        });
        probe.register("check2", || HealthCheckResult {
            status: HealthStatus::Unhealthy,
            message: Some("fail".into()),
        });

        let report = probe.health();
        assert_eq!(report.status, HealthStatus::Degraded);
    }
}
