package bartender

import (
	"context"
	"fmt"
	"time"

	toggleswitch "go.viam.com/rdk/components/switch"
)

const (
	poseHome         = "home"
	poseHover        = "hover"
	poseCarryHover   = "carry-hover"
	poseLift         = "lift"
	poseGrab         = "grab"
	posePourApproach = "pour-approach"
	posePourTilt     = "pour-tilt"
)

func (b *bartender) pickupPourReturn(ctx context.Context, bottleSwitchName string, pourMs int) error {
	bottleSw, err := b.findSwitch(bottleSwitchName)
	if err != nil {
		return err
	}
	if err := b.pickupBottle(ctx, bottleSw); err != nil {
		return err
	}

	if _, err := b.carryHeldToUniversal(ctx, posePourApproach); err != nil {
		return fmt.Errorf("carry to pour-approach: %w", err)
	}
	pourOpts := b.pourMoveOptions()
	if _, err := b.moveArmToPoseWithOpts(ctx, posePourTilt, pourOpts); err != nil {
		return fmt.Errorf("pour-tilt: %w", err)
	}
	if err := sleepCtx(ctx, time.Duration(pourMs)*time.Millisecond); err != nil {
		return fmt.Errorf("pour dwell: %w", err)
	}
	if _, err := b.moveArmToPoseWithOpts(ctx, posePourApproach, pourOpts); err != nil {
		return fmt.Errorf("pour-upright: %w", err)
	}

	return b.returnBottle(ctx, bottleSw)
}

// Ends holding the bottle at its carry-hover pose.
func (b *bartender) pickupBottle(ctx context.Context, bottleSw toggleswitch.Switch) error {
	name := bottleSw.Name().ShortName()
	allowed := append(b.pickupAllowedCollisions(name), b.bottlesProtectorAllowed()...)
	if _, err := b.moveArmToPoseOnSwitch(ctx, bottleSw, poseHover, allowed...); err != nil {
		return fmt.Errorf("hover %s: %w", name, err)
	}
	if err := b.gripper.Open(ctx, nil); err != nil {
		return fmt.Errorf("open gripper: %w", err)
	}
	if _, err := b.linearMoveToPose(ctx, bottleSw, poseGrab, allowed...); err != nil {
		return fmt.Errorf("linear-grab %s: %w", name, err)
	}
	if _, err := b.gripper.Grab(ctx, nil); err != nil {
		return fmt.Errorf("close gripper on %s: %w", name, err)
	}
	if err := b.attachHeld(ctx, "bottle", b.cfg.HeldBottleGeometry); err != nil {
		return fmt.Errorf("attach held bottle: %w", err)
	}
	if _, err := b.linearCarryToPose(ctx, bottleSw, poseLift, allowed...); err != nil {
		return fmt.Errorf("linear-lift %s: %w", name, err)
	}
	if _, err := b.linearCarryToPose(ctx, bottleSw, poseCarryHover, allowed...); err != nil {
		return fmt.Errorf("carry-hover %s: %w", name, err)
	}
	return nil
}

// Parks the arm at the carry-hover for the given shaker source with the shaker
// gripped and the HeldObjectGeometry attached, so an operator can open the
// simulation and visually confirm the capsule position relative to the gripper.
// Does not release.
func (b *bartender) pickupShaker(ctx context.Context, sw toggleswitch.Switch, source string) error {
	shakerAllow := b.pickupAllowedCollisions(source)
	switch source {
	case "shaker-home":
		if _, err := b.moveArmToPoseOnSwitch(ctx, sw, poseShakerHomeHover); err != nil {
			return fmt.Errorf("shaker-home-hover: %w", err)
		}
		if err := b.gripper.Open(ctx, nil); err != nil {
			return fmt.Errorf("open gripper before shaker grab: %w", err)
		}
		if _, err := b.linearMoveToPose(ctx, sw, poseShakerHomeApproach, shakerAllow...); err != nil {
			return fmt.Errorf("linear-to shaker-home-approach: %w", err)
		}
		if _, err := b.linearMoveToPose(ctx, sw, poseShakerHomeLift, shakerAllow...); err != nil {
			return fmt.Errorf("linear-lift shaker before closing: %w", err)
		}
		if _, err := b.gripper.Grab(ctx, nil); err != nil {
			return fmt.Errorf("close gripper on shaker-home: %w", err)
		}
		if err := b.attachHeld(ctx, "shaker", b.cfg.HeldShakerGeometry); err != nil {
			return fmt.Errorf("attach held shaker from shaker-home: %w", err)
		}
		if _, err := b.carryHeldLevel(ctx, sw, poseShakerHomeCarryHover, shakerAllow...); err != nil {
			return fmt.Errorf("carry to shaker-home-carry-hover: %w", err)
		}
	case "shaker-a":
		if _, err := b.moveArmToPoseOnSwitch(ctx, sw, poseShakerAHover); err != nil {
			return fmt.Errorf("shaker-a-hover: %w", err)
		}
		if err := b.gripper.Open(ctx, nil); err != nil {
			return fmt.Errorf("open gripper before shaker-a grab: %w", err)
		}
		if _, err := b.linearMoveToPose(ctx, sw, poseShakerAApproach, shakerAllow...); err != nil {
			return fmt.Errorf("linear-to shaker-a-approach: %w", err)
		}
		if _, err := b.linearMoveToPose(ctx, sw, poseShakerALift, shakerAllow...); err != nil {
			return fmt.Errorf("linear-lift at shaker-a: %w", err)
		}
		if _, err := b.gripper.Grab(ctx, nil); err != nil {
			return fmt.Errorf("close gripper on shaker-a: %w", err)
		}
		if err := b.attachHeld(ctx, "shaker", b.cfg.HeldShakerGeometry); err != nil {
			return fmt.Errorf("attach held shaker from shaker-a: %w", err)
		}
		if _, err := b.carryHeldLevel(ctx, sw, poseShakerACarryHover, shakerAllow...); err != nil {
			return fmt.Errorf("carry to shaker-a-carry-hover: %w", err)
		}
	case "shaker-b":
		if _, err := b.moveArmToPoseOnSwitch(ctx, sw, poseShakerBHover); err != nil {
			return fmt.Errorf("shaker-b-hover: %w", err)
		}
		if err := b.gripper.Open(ctx, nil); err != nil {
			return fmt.Errorf("open gripper before shaker-b grab: %w", err)
		}
		if _, err := b.linearMoveToPose(ctx, sw, poseShakerBDescend, shakerAllow...); err != nil {
			return fmt.Errorf("linear-to shaker-b-descend: %w", err)
		}
		if _, err := b.linearMoveToPose(ctx, sw, poseShakerBPlace, shakerAllow...); err != nil {
			return fmt.Errorf("linear-to shaker-b-place: %w", err)
		}
		if _, err := b.gripper.Grab(ctx, nil); err != nil {
			return fmt.Errorf("close gripper on shaker-b: %w", err)
		}
		if err := b.attachHeld(ctx, "shaker", b.cfg.HeldShakerGeometry); err != nil {
			return fmt.Errorf("attach held shaker from shaker-b: %w", err)
		}
		if _, err := b.linearCarryToPose(ctx, sw, poseShakerBHoverAbove, shakerAllow...); err != nil {
			return fmt.Errorf("linear-lift to shaker-b-hover-above: %w", err)
		}
	default:
		return fmt.Errorf("pickupShaker: unknown source %q (want shaker-home, shaker-a, or shaker-b)", source)
	}
	return nil
}

// Starts from anywhere with the bottle held upright; ends empty-handed at home.
func (b *bartender) returnBottle(ctx context.Context, bottleSw toggleswitch.Switch) error {
	name := bottleSw.Name().ShortName()
	allowed := append(b.pickupAllowedCollisions(name), b.bottlesProtectorAllowed()...)
	if _, err := b.carryHeldLevel(ctx, bottleSw, poseCarryHover, allowed...); err != nil {
		return fmt.Errorf("carry back to %s carry-hover: %w", name, err)
	}
	if _, err := b.linearCarryToPose(ctx, bottleSw, poseLift, allowed...); err != nil {
		return fmt.Errorf("linear-over %s: %w", name, err)
	}
	if _, err := b.linearCarryToPose(ctx, bottleSw, poseGrab, allowed...); err != nil {
		return fmt.Errorf("linear-return %s: %w", name, err)
	}
	if err := b.gripper.Open(ctx, nil); err != nil {
		return fmt.Errorf("release gripper: %w", err)
	}
	b.detachHeld()
	if _, err := b.linearMoveToPose(ctx, bottleSw, poseHover, allowed...); err != nil {
		return fmt.Errorf("linear-retreat %s: %w", name, err)
	}
	return nil
}

func (b *bartender) carryHeldToUniversal(ctx context.Context, poseName string) (time.Duration, error) {
	_, sw, err := b.resolvePose(ctx, poseName)
	if err != nil {
		return 0, err
	}
	return b.carryHeldLevel(ctx, sw, poseName)
}

func sleepCtx(ctx context.Context, d time.Duration) error {
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-time.After(d):
		return nil
	}
}
