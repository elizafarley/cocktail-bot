package bartender

import (
	"context"
	"errors"
	"fmt"
)

func (b *bartender) makeCocktail(ctx context.Context, drinkID string, recipe *Recipe) error {
	if recipe == nil {
		if drinkID == "" {
			return errors.New("make_cocktail: either drink_id or recipe is required")
		}
		if b.dataStore == nil {
			return errDataStoreNotConfigured
		}
		for _, r := range b.dataStore.Recipes() {
			if r.ID == drinkID {
				rCopy := r
				recipe = &rCopy
				break
			}
		}
		if recipe == nil {
			return fmt.Errorf("make_cocktail: recipe %q not found", drinkID)
		}
	}
	d := b.cfg.RecipeDefaults
	if d == nil {
		return errors.New("make_cocktail: recipe_defaults not configured on bartender service")
	}
	if d.ShakerSource == "" || d.IceStation == "" || d.MixerStation == "" || d.StrainFlow == "" || d.ServeStation == "" {
		return errors.New("make_cocktail: recipe_defaults is missing one of shaker_source, ice_station, mixer_station, strain_flow, serve_station")
	}

	steps := stepsFor(*recipe)
	pouredToShaker := false
	for i, step := range steps {
		switch step.Kind {
		case "pour":
			if step.Ingredient == "" {
				return fmt.Errorf("step %d: pour ingredient is required", i+1)
			}
			target := step.Target
			if target == "" {
				target = "shaker"
			}
			b.status.setPhase(fmt.Sprintf("Pouring %s (step %d of %d)", step.Ingredient, i+1, len(steps)))
			switch target {
			case "shaker":
				if err := b.pourIntoShaker(ctx, step.Ingredient, step.Oz); err != nil {
					return fmt.Errorf("step %d pour %s into shaker: %w", i+1, step.Ingredient, err)
				}
				pouredToShaker = true
			case "glass":
				return fmt.Errorf("step %d pour %s into glass: not yet supported", i+1, step.Ingredient)
			default:
				return fmt.Errorf("step %d pour target %q is not valid", i+1, target)
			}
		case "ice":
			iceType := step.IceType
			if iceType == "" {
				iceType = "crushed"
			}
			target := step.Target
			if target == "" {
				target = "shaker"
			}
			if iceType != "crushed" || target != "shaker" {
				return fmt.Errorf("step %d ice (%s into %s): not yet supported", i+1, iceType, target)
			}
			b.status.setPhase("Dispensing ice")
			if err := b.dispenseIce(ctx, d.IceStation, d.IceDwellMs); err != nil {
				return fmt.Errorf("step %d dispense ice: %w", i+1, err)
			}
		case "mix":
			mode := step.MixMode
			if mode == "" {
				mode = "shake"
			}
			if mode != "shake" {
				return fmt.Errorf("step %d mix mode %q is not yet supported", i+1, mode)
			}
			b.status.setPhase("Shaking")
			if err := b.mix(ctx, d.MixerStation, d.MixDwellMs); err != nil {
				return fmt.Errorf("step %d shake: %w", i+1, err)
			}
		case "strain":
			b.status.setPhase("Straining")
			if err := b.strainShaker(ctx, strainShakerRequest{
				source:       d.ShakerSource,
				strainFlow:   d.StrainFlow,
				drainDwellMs: d.StrainDrainMs,
				dumpDwellMs:  d.StrainDumpMs,
			}); err != nil {
				return fmt.Errorf("step %d strain: %w", i+1, err)
			}
		default:
			return fmt.Errorf("step %d: unknown kind %q", i+1, step.Kind)
		}
	}

	if pouredToShaker {
		b.status.setPhase("Serving")
		if err := b.pourFromShaker(ctx, d.ServeStation, d.ServeMs); err != nil {
			return fmt.Errorf("serve: %w", err)
		}
		b.status.setPhase("Resetting")
		if err := b.rotateShakers(ctx, d.StrainFlow); err != nil {
			return fmt.Errorf("rotate: %w", err)
		}
	}
	return nil
}
