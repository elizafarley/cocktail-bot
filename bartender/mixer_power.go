package bartender

import (
	"context"
	"errors"
	"fmt"
	"sync"
	"time"
)

const mixerPowerTimeout = 10 * time.Second

var errMixerPowerUnavailable = errors.New("mixer power switch not available")

// startMixer powers the mixer on and returns an idempotent func that powers it off. Failures
// only warn, so an operator can switch the mixer by hand and the order still completes.
func (b *bartender) startMixer(ctx context.Context) func() {
	if b.cfg.MixerPowerSwitchName == "" {
		return func() {}
	}
	b.setMixerPower(ctx, true)
	var once sync.Once
	return func() { once.Do(func() { b.setMixerPower(ctx, false) }) }
}

func (b *bartender) setMixerPower(ctx context.Context, on bool) {
	if on && ctx.Err() != nil {
		return
	}
	// Powering off must still happen after an operator cancel.
	if !on {
		ctx = context.WithoutCancel(ctx)
	}
	ctx, cancel := context.WithTimeout(ctx, mixerPowerTimeout)
	defer cancel()

	err := errMixerPowerUnavailable
	if b.mixerPower != nil {
		var pos uint32
		if on {
			pos = 1
		}
		err = b.mixerPower.SetPosition(ctx, pos, nil)
	}
	if err == nil {
		return
	}
	b.logger.Warnf("mixer power %q: %v", b.cfg.MixerPowerSwitchName, err)
	go slackPost(context.Background(), b.logger, b.slackWebhookURL(), mixerPowerWarning(on, orderIDFromCtx(ctx), err), nil)
}

func mixerPowerWarning(on bool, orderID string, err error) string {
	action := "on — flip its switch on by hand"
	if !on {
		action = "off — switch it off by hand"
	}
	suffix := ""
	if orderID != "" {
		suffix = fmt.Sprintf(" [order %s]", escapeSlackMrkdwn(orderID))
	}
	return fmt.Sprintf(":warning: Couldn't turn the mixer %s%s: %s", action, suffix, escapeSlackMrkdwn(err.Error()))
}

func (b *bartender) powerOffMixerOnClose(ctx context.Context) {
	if b.mixerPower == nil {
		return
	}
	ctx, cancel := context.WithTimeout(context.WithoutCancel(ctx), mixerPowerTimeout)
	defer cancel()
	if err := b.mixerPower.SetPosition(ctx, 0, nil); err != nil {
		b.logger.Warnf("power off mixer %q on close: %v", b.cfg.MixerPowerSwitchName, err)
	}
}
