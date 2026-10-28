package bartender

import (
	"context"
	"fmt"
)

const (
	posePourGlassApproach = "direct-pour-approach"
	posePourGlassTilt     = "direct-pour-tilt"
	posePourGlassRecover  = "direct-pour-recover"
)

func (b *bartender) pourIntoGlass(ctx context.Context, ingredient string, oz float64) error {
	slot, err := b.slotForIngredient(ingredient)
	if err != nil {
		return err
	}
	bottleSw, err := b.findSwitch(slot)
	if err != nil {
		return err
	}
	if b.dataStore == nil {
		return errDataStoreNotConfigured
	}
	pourerOz, ok := b.dataStore.PourerOz()[ingredient]
	if !ok {
		return fmt.Errorf("no pourer oz configured for ingredient %q", ingredient)
	}
	pours, err := pourCount(oz, pourerOz)
	if err != nil {
		return err
	}

	if _, _, err := b.resolvePose(ctx, posePourGlassApproach); err != nil {
		return fmt.Errorf("direct pour into glass needs a pose switcher that defines %q, %q and %q: %w",
			posePourGlassApproach, posePourGlassTilt, posePourGlassRecover, err)
	}

	if err := b.pickupBottle(ctx, bottleSw); err != nil {
		return err
	}
	if _, err := b.carryHeldToUniversal(ctx, posePourGlassApproach); err != nil {
		return fmt.Errorf("carry to %s: %w", posePourGlassApproach, err)
	}

	pourOpts := b.pourMoveOptions()
	for i := 0; i < pours; i++ {
		if _, err := b.moveArmToPoseWithOpts(ctx, posePourGlassTilt, pourOpts); err != nil {
			return fmt.Errorf("%s (pour %d/%d): %w", posePourGlassTilt, i+1, pours, err)
		}
		if err := sleepCtx(ctx, b.pourIntoShakerDwell()); err != nil {
			return fmt.Errorf("direct pour dwell: %w", err)
		}
		if _, err := b.moveArmToPoseWithOpts(ctx, posePourGlassApproach, pourOpts); err != nil {
			return fmt.Errorf("%s (pour %d/%d): %w", posePourGlassApproach, i+1, pours, err)
		}
	}

	if _, err := b.moveArmToPoseWithOpts(ctx, posePourGlassRecover, pourOpts); err != nil {
		return fmt.Errorf("%s: %w", posePourGlassRecover, err)
	}

	return b.returnBottle(ctx, bottleSw)
}
