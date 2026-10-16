# cocktail-cli

Developer CLI for cocktail-bot. Not for operators — the kiosk is.

## Build

```bash
make cli      # bin/cocktail-cli
viam login    # cached credentials
```

Every command takes `--machine-address <part>.viam.cloud`.

## `hover-glass`

Finds the top-scoring glass, moves `--component` (tool down) to its (x, y) at `--hover-z-mm`. Builds the glass finder locally; the bartender module doesn't need to be deployed.

```bash
# Preview + save detected cloud.
bin/cocktail-cli hover-glass --machine-address <part>.viam.cloud --camera cam \
  --dry-run --save-pcd glass.pcd

# Move.
bin/cocktail-cli hover-glass --machine-address <part>.viam.cloud --camera cam --component gripper
```

| Flag | Required | Default | Description |
| --- | --- | --- | --- |
| `--machine-address` | yes | — | Machine part address |
| `--camera` | yes | — | RGB-D camera, must be in the frame system |
| `--component` | yes (unless `--dry-run`) | — | Frame to hover above the glass |
| `--detector` | no | `yolov8` | 2D detector vision service |
| `--labels` | no | `wine glass, cup` | Detector labels counted as a glass |
| `--min-confidence` | no | `0.5` | Minimum detection score |
| `--motion` | no | `builtin` | Motion service |
| `--hover-z-mm` | no | `300` | World-frame z of the hover pose (mm) |
| `--dry-run` | no | `false` | Print target pose; don't move |
| `--save-pcd` | no | — | Write glass's world-frame cloud to this path |

## `pour-glass`

Finds the glass with the wrist camera, picks up `--bottle`, pours `--pour-ms` into it. Wraps bartender `find_and_pour`. `--find-only` runs just the search (`find_glass`); the arm moves but no bottle is touched.

Search: start at `glass-look`, then pan/lower per `glass_search_pan_deg` × `glass_search_lower_mm`, settling `glass_search_settle_ms` between. First view with a glass wins.

Pour: the bottle mouth is assumed to sit `--mouth-offset-mm` from the gripper on the side it tips. Saved `pour-approach` + `pour-tilt` are shifted in x, y so the mouth lands over the glass (z and tilt kept). Shifts over `max_pour_offset_mm` (300) fail before the bottle is picked up.

```bash
bin/cocktail-cli pour-glass --machine-address <part>.viam.cloud --find-only
bin/cocktail-cli pour-glass --machine-address <part>.viam.cloud --bottle bottle-gin --pour-ms 1500
bin/cocktail-cli pour-glass --machine-address <part>.viam.cloud --bottle bottle-gin --pour-ms 1500 --mouth-offset-mm 80
```

| Flag | Required | Default | Description |
| --- | --- | --- | --- |
| `--machine-address` | yes | — | Machine part address |
| `--bottle` | yes (unless `--find-only`) | — | Bottle station switch to pour from |
| `--pour-ms` | yes (unless `--find-only`) | — | Pour duration (ms) |
| `--find-only` | no | `false` | Only search; don't touch the bottle |
| `--mouth-offset-mm` | no | bartender's `pour_mouth_offset_mm` | Gripper-to-mouth distance (mm); negative flips the side |
| `--bartender` | no | `bartender` | Bartender service name |
