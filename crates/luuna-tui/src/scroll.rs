//! Display-only eased scrolling. The target offset is where the user asked to go;
//! the displayed offset is what is drawn. Time is injected as frame deltas, so
//! everything here is deterministic. Terminal cells cannot be positioned below one
//! row, so motion happens in whole-row steps.

use std::time::Duration;

pub const DEFAULT_SCROLL_DURATION: Duration = Duration::from_millis(120);
pub const FIRST_FRAME_HINT: Duration = Duration::from_millis(16);

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ScrollMotion {
    Instant,
    Eased(Duration),
}

impl ScrollMotion {
    /// None or unknown -> eased (default duration); "0" | "off" | "false" | "no"
    /// (trimmed, ASCII case-insensitive) -> instant.
    pub fn from_env_value(value: Option<&str>) -> Self {
        let off = value.is_some_and(|v| {
            let v = v.trim();
            ["0", "off", "false", "no"]
                .iter()
                .any(|word| v.eq_ignore_ascii_case(word))
        });
        if off {
            Self::Instant
        } else {
            Self::Eased(DEFAULT_SCROLL_DURATION)
        }
    }

    /// Reads `LUUNA_TUI_ANIMATION`. Only `main.rs` calls this.
    pub fn from_env() -> Self {
        Self::from_env_value(std::env::var("LUUNA_TUI_ANIMATION").ok().as_deref())
    }
}

/// One frame of exponential (critically damped, no overshoot) approach in whole rows.
/// `tau == 0` or `displayed == target` gives `target`; otherwise the step is
/// `ceil(remaining * (1 - exp(-dt/tau)))` clamped to `1..=remaining`.
pub fn step_toward(displayed: u16, target: u16, dt: Duration, tau: Duration) -> u16 {
    if displayed == target || tau.is_zero() {
        return target;
    }
    let remaining = u32::from(displayed.abs_diff(target));
    let fraction = 1.0 - (-dt.as_secs_f64() / tau.as_secs_f64()).exp();
    let step = (f64::from(remaining) * fraction).ceil();
    let step = if step.is_finite() {
        step as u32
    } else {
        remaining
    };
    let step = step.clamp(1, remaining);
    let moved = if target > displayed {
        u32::from(displayed) + step
    } else {
        u32::from(displayed) - step
    };
    u16::try_from(moved).unwrap_or(u16::MAX)
}

#[derive(Clone, Debug)]
pub struct ScrollState {
    target: u16,
    displayed: u16,
    max: Option<u16>,
    follow: bool,
    down_intent: bool,
    motion: ScrollMotion,
    elapsed: Option<Duration>,
}

impl Default for ScrollState {
    fn default() -> Self {
        Self::with_motion(ScrollMotion::Instant)
    }
}

impl ScrollState {
    pub fn with_motion(motion: ScrollMotion) -> Self {
        Self {
            target: 0,
            displayed: 0,
            max: None,
            follow: false,
            down_intent: false,
            motion,
            elapsed: None,
        }
    }

    pub fn set_motion(&mut self, motion: ScrollMotion) {
        self.motion = motion;
        if motion == ScrollMotion::Instant {
            self.displayed = self.effective();
            self.elapsed = None;
        }
    }

    pub fn target(&self) -> u16 {
        self.target
    }

    pub fn displayed(&self) -> u16 {
        self.displayed
    }

    pub fn reset(&mut self) {
        self.target = 0;
        self.displayed = 0;
        self.follow = false;
        self.down_intent = false;
        self.max = None;
        self.elapsed = None;
    }

    pub fn scroll_up(&mut self, rows: u16) {
        self.target = self.target.saturating_sub(rows);
        self.follow = false;
        self.down_intent = false;
        self.retarget();
    }

    pub fn scroll_down(&mut self, rows: u16) {
        self.target = self.target.saturating_add(rows);
        self.down_intent = true;
        self.retarget();
    }

    pub fn to_top(&mut self) {
        self.scroll_up(u16::MAX);
    }

    pub fn to_bottom(&mut self) {
        self.target = u16::MAX;
        self.follow = true;
        self.retarget();
    }

    fn effective(&self) -> u16 {
        self.target.min(self.max.unwrap_or(self.target))
    }

    fn retarget(&mut self) {
        let effective = self.effective();
        if self.motion == ScrollMotion::Instant
            || self.max.is_none()
            || self.displayed.abs_diff(effective) <= 1
        {
            self.displayed = effective;
        }
        self.elapsed = None;
    }

    /// Called by renderers with this frame's content bound; returns the offset to draw.
    pub fn clamp(&mut self, max: u16) -> u16 {
        self.max = Some(max);
        if self.down_intent && self.target >= max {
            self.follow = true;
        }
        self.down_intent = false;
        self.target = if self.follow {
            max
        } else {
            self.target.min(max)
        };
        self.displayed = self.displayed.min(max);
        if self.motion == ScrollMotion::Instant || self.displayed.abs_diff(self.target) <= 1 {
            self.displayed = self.target;
        }
        self.displayed
    }

    /// Advance by the time since the previous frame. The first frame of a motion
    /// uses `FIRST_FRAME_HINT` so movement starts immediately; the animation snaps
    /// exactly onto the target once the configured duration has elapsed.
    pub fn advance(&mut self, dt: Duration) {
        let ScrollMotion::Eased(duration) = self.motion else {
            return;
        };
        let effective = self.effective();
        if self.displayed == effective {
            self.elapsed = None;
            return;
        }
        let (elapsed, dt) = match self.elapsed {
            None => (FIRST_FRAME_HINT, FIRST_FRAME_HINT),
            Some(previous) => (previous.saturating_add(dt), dt),
        };
        if elapsed >= duration {
            self.displayed = effective;
            self.elapsed = None;
        } else {
            self.displayed = step_toward(self.displayed, effective, dt, duration / 4);
            self.elapsed = Some(elapsed);
        }
    }

    pub fn animating(&self) -> bool {
        self.motion != ScrollMotion::Instant && self.displayed != self.effective()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ms(n: u64) -> Duration {
        Duration::from_millis(n)
    }

    fn eased() -> ScrollState {
        ScrollState::with_motion(ScrollMotion::Eased(DEFAULT_SCROLL_DURATION))
    }

    #[test]
    fn step_toward_is_monotonic_bounded_and_terminates() {
        for distance in 2u16..=600 {
            for dt in [0, 1, 8, 16, 33, 100, 500] {
                for (from, to) in [(0, distance), (distance, 0)] {
                    let mut at = from;
                    let mut calls = 0u32;
                    while at != to {
                        let next = step_toward(at, to, ms(dt), ms(30));
                        assert!(next.abs_diff(to) < at.abs_diff(to), "must move");
                        assert!(next.abs_diff(at) <= at.abs_diff(to), "no overshoot");
                        assert_eq!(next > at, to > at);
                        at = next;
                        calls += 1;
                        assert!(calls <= u32::from(distance));
                    }
                }
            }
        }
    }

    #[test]
    fn reset_clears_max_so_the_next_pane_snaps_until_rendered() {
        let mut s = eased();
        s.clamp(100);
        s.scroll_down(50);
        assert_ne!(s.displayed(), s.target());
        s.reset();
        assert_eq!((s.target(), s.displayed()), (0, 0));
        s.scroll_down(40);
        assert_eq!(s.displayed(), 40, "unknown bound must snap, not ease");
    }

    #[test]
    fn zero_tau_returns_target() {
        assert_eq!(step_toward(3, 90, ms(16), Duration::ZERO), 90);
        assert_eq!(step_toward(90, 3, ms(16), Duration::ZERO), 3);
    }

    #[test]
    fn eased_page_jump_lands_exactly_within_the_duration() {
        let mut s = eased();
        s.clamp(100);
        s.scroll_down(8);
        assert!(s.animating());
        let mut previous = s.displayed();
        let mut total = Duration::ZERO;
        while s.animating() {
            s.advance(ms(16));
            total += ms(16);
            assert!(s.displayed() > previous && s.displayed() <= 8);
            previous = s.displayed();
            assert!(total <= DEFAULT_SCROLL_DURATION + ms(16));
        }
        assert_eq!(s.displayed(), 8);
        assert_eq!(s.clamp(100), 8);
    }

    #[test]
    fn single_row_move_is_instant_when_eased() {
        let mut s = eased();
        s.clamp(100);
        s.scroll_down(1);
        assert_eq!(s.displayed(), 1);
        assert!(!s.animating());
        s.scroll_up(1);
        assert_eq!(s.displayed(), 0);
    }

    #[test]
    fn instant_motion_needs_no_tick() {
        let mut s = ScrollState::default();
        s.scroll_down(8);
        assert_eq!(s.displayed(), 8);
        assert_eq!(s.clamp(5), 5);
        s.to_bottom();
        assert_eq!(s.displayed(), 5);
        s.to_top();
        assert_eq!((s.displayed(), s.target()), (0, 0));
        assert!(!s.animating());
    }

    #[test]
    fn shrink_clamps_immediately() {
        let mut s = eased();
        s.clamp(100);
        s.scroll_down(80);
        s.advance(ms(16));
        assert_eq!(s.clamp(30), s.displayed());
        assert!(s.displayed() <= 30);
        assert_eq!(s.target(), 30);
        for _ in 0..20 {
            s.advance(ms(16));
            assert!(s.displayed() <= 30);
        }
        assert_eq!(s.displayed(), 30);
    }

    #[test]
    fn follow_pins_to_bottom_and_unpins_on_scroll_up() {
        let mut s = eased();
        s.to_bottom();
        s.clamp(10);
        assert_eq!(s.displayed(), 10);
        s.clamp(40);
        assert_eq!(s.target(), 40);
        while s.animating() {
            s.advance(ms(16));
        }
        assert_eq!(s.displayed(), 40);
        s.scroll_up(1);
        s.clamp(60);
        assert_eq!(s.target(), 39);

        let mut fresh = eased();
        fresh.clamp(0);
        fresh.clamp(50);
        assert_eq!((fresh.target(), fresh.displayed()), (0, 0));
    }

    #[test]
    fn retarget_mid_animation_never_steps_backward() {
        let mut s = eased();
        s.clamp(200);
        s.scroll_down(80);
        s.advance(ms(16));
        s.advance(ms(16));
        let mid = s.displayed();
        assert!(mid > 0);
        s.scroll_down(8);
        assert_eq!(s.displayed(), mid);
        s.advance(ms(16));
        assert!(s.displayed() >= mid);
    }

    #[test]
    fn env_value_parsing() {
        let eased = ScrollMotion::Eased(DEFAULT_SCROLL_DURATION);
        assert_eq!(ScrollMotion::from_env_value(None), eased);
        assert_eq!(ScrollMotion::from_env_value(Some("1")), eased);
        assert_eq!(ScrollMotion::from_env_value(Some("yes")), eased);
        for off in ["0", "OFF", " false ", "no"] {
            assert_eq!(
                ScrollMotion::from_env_value(Some(off)),
                ScrollMotion::Instant
            );
        }
    }
}
