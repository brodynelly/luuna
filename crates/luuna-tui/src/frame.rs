//! Deterministic frame clock: draws are event-driven, capped at a fixed cadence and
//! independent of when events arrive. Every method takes an injected `now`.

use std::time::{Duration, Instant};

pub const DEFAULT_FPS: u32 = 60;
pub const MIN_FPS: u32 = 30;
pub const MAX_FPS: u32 = 144;

/// None, empty, unparsable or zero -> `DEFAULT_FPS`; otherwise clamped to the supported range.
pub fn fps_from(value: Option<&str>) -> u32 {
    match value.and_then(|v| v.trim().parse::<u32>().ok()) {
        Some(0) | None => DEFAULT_FPS,
        Some(fps) => fps.clamp(MIN_FPS, MAX_FPS),
    }
}

/// Synchronized output is on unless explicitly disabled.
pub fn sync_from(value: Option<&str>) -> bool {
    !value.is_some_and(|v| {
        let v = v.trim();
        ["0", "false", "off", "no"]
            .iter()
            .any(|off| v.eq_ignore_ascii_case(off))
    })
}

pub struct FrameClock {
    interval: Duration,
    dirty: bool,
    animation_requested: bool,
    last_frame: Option<Instant>,
}

impl FrameClock {
    pub fn new(fps: u32) -> Self {
        let fps = fps.clamp(MIN_FPS, MAX_FPS);
        Self {
            interval: Duration::from_nanos(1_000_000_000 / u64::from(fps)),
            dirty: false,
            animation_requested: false,
            last_frame: None,
        }
    }

    pub fn from_env() -> Self {
        Self::new(fps_from(std::env::var("LUUNA_TUI_FPS").ok().as_deref()))
    }

    pub fn interval(&self) -> Duration {
        self.interval
    }

    pub fn mark_dirty(&mut self) {
        self.dirty = true;
    }

    pub fn is_dirty(&self) -> bool {
        self.dirty
    }

    /// One-shot, like requestAnimationFrame: schedules exactly one more frame at cadence.
    /// Animators must re-request every frame while they animate.
    pub fn request_animation_frame(&mut self) {
        self.animation_requested = true;
    }

    /// None when neither dirty nor animation requested (idle: block indefinitely).
    /// Otherwise `max(now, last_frame + interval)`; `now` if no frame has been drawn.
    pub fn next_deadline(&self, now: Instant) -> Option<Instant> {
        if !self.dirty && !self.animation_requested {
            return None;
        }
        Some(match self.last_frame {
            Some(last) => (last + self.interval).max(now),
            None => now,
        })
    }

    pub fn should_draw(&self, now: Instant) -> bool {
        self.next_deadline(now).is_some_and(|d| d <= now)
    }

    /// Time since the previous frame, clamped to `4 * interval` (zero for the first frame).
    pub fn frame_delta(&self, now: Instant) -> Duration {
        self.last_frame.map_or(Duration::ZERO, |last| {
            now.saturating_duration_since(last).min(self.interval * 4)
        })
    }

    /// Record a completed frame: clears dirty and the animation request.
    pub fn frame_drawn(&mut self, now: Instant) {
        self.dirty = false;
        self.animation_requested = false;
        self.last_frame = Some(now);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ms(n: u64) -> Duration {
        Duration::from_millis(n)
    }

    #[test]
    fn idle_clock_never_schedules() {
        let t0 = Instant::now();
        let mut clock = FrameClock::new(60);
        clock.mark_dirty();
        clock.frame_drawn(t0);
        assert_eq!(clock.next_deadline(t0 + Duration::from_secs(10)), None);
        assert!(!clock.should_draw(t0 + Duration::from_secs(10)));
    }

    #[test]
    fn first_dirty_frame_draws_immediately() {
        let t0 = Instant::now();
        let mut clock = FrameClock::new(60);
        clock.mark_dirty();
        assert!(clock.should_draw(t0));
    }

    #[test]
    fn burst_within_interval_coalesces_to_one_frame() {
        let t0 = Instant::now();
        let mut clock = FrameClock::new(60);
        clock.mark_dirty();
        clock.frame_drawn(t0);
        for i in 1..=15 {
            clock.mark_dirty();
            clock.mark_dirty();
            assert!(!clock.should_draw(t0 + ms(i)));
        }
        let interval = clock.interval();
        assert!(!clock.should_draw(t0 + interval - Duration::from_nanos(1)));
        assert!(clock.should_draw(t0 + interval));
        clock.frame_drawn(t0 + interval);
        assert_eq!(clock.next_deadline(t0 + interval), None);
    }

    #[test]
    fn animation_frames_follow_cadence() {
        let t0 = Instant::now();
        let mut clock = FrameClock::new(60);
        let mut frames: Vec<Instant> = Vec::new();
        for step in 0..1000 {
            let now = t0 + ms(step);
            clock.request_animation_frame();
            if clock.should_draw(now) {
                clock.frame_drawn(now);
                frames.push(now);
            }
        }
        assert!((59..=61).contains(&frames.len()), "{}", frames.len());
        for pair in frames.windows(2) {
            assert!(pair[1] - pair[0] >= clock.interval());
        }
    }

    #[test]
    fn animation_request_is_one_shot() {
        let t0 = Instant::now();
        let mut clock = FrameClock::new(60);
        clock.request_animation_frame();
        clock.frame_drawn(t0);
        assert_eq!(clock.next_deadline(t0 + ms(100)), None);
    }

    #[test]
    fn cap_respected_under_dirty_storm() {
        let t0 = Instant::now();
        let mut clock = FrameClock::new(60);
        let mut frames = 0;
        for step in 0..1000 {
            let now = t0 + ms(step);
            clock.mark_dirty();
            if clock.should_draw(now) {
                clock.frame_drawn(now);
                frames += 1;
            }
        }
        assert!(frames <= 61, "{frames}");
    }

    #[test]
    fn fps_env_parsing() {
        for value in [None, Some(""), Some("abc"), Some("0")] {
            assert_eq!(fps_from(value), 60);
        }
        assert_eq!(fps_from(Some("10")), 30);
        assert_eq!(fps_from(Some("1000")), 144);
        assert_eq!(fps_from(Some("120")), 120);
        assert_eq!(fps_from(Some(" 90 ")), 90);
    }

    #[test]
    fn sync_env_parsing() {
        assert!(sync_from(None));
        for off in ["0", "false", "OFF", "no", " off "] {
            assert!(!sync_from(Some(off)), "{off}");
        }
        assert!(sync_from(Some("1")));
        assert!(sync_from(Some("yes")));
    }

    #[test]
    fn frame_delta_is_clamped() {
        let t0 = Instant::now();
        let mut clock = FrameClock::new(60);
        assert_eq!(clock.frame_delta(t0), Duration::ZERO);
        clock.frame_drawn(t0);
        assert_eq!(
            clock.frame_delta(t0 + Duration::from_secs(10)),
            clock.interval() * 4
        );
    }
}
