# Experiment record example

`chongqing-slope.json` is a small, real, metadata-only import for Cumora's
experiment records. It implements `ExperimentBundle` in
[`shared/experiments.ts`](../../shared/experiments.ts): schema version 1, two runs,
and one recorded comparison. Import this JSON using the experiment records UI.

The feature stores and displays records. It does **not** execute `gdaldem`, open
local paths, install software, or reproduce the experiment. The saved commands
are inert argument arrays with `{input}` and `{output}` placeholders. Raster
bytes and executable Python snapshots are **not included** in this example.

## What the records establish

- Horn run: `20261007T093734Z_horn_2787d459`
- Zevenbergen–Thorne run: `20261007T093742Z_zt_64ecf72b`
- Both used the same preserved input, grid, units, and strict valid 3 × 3
  neighbourhood policy; both exited successfully on October 7, 2026.
- Common valid pixels: **8,196,757**. Mean slope: **14.389192582967581°** (Horn)
  and **14.98141344910376°** (Zevenbergen–Thorne).
- The recorded comparison's mean absolute difference is
  **1.0366253723873664°**, and RMSE is **1.42336520599818°**. Signed differences
  mean Zevenbergen–Thorne minus Horn. Proportions are fractions, not percentages.
- The separate recorded Horn replay,
  `20261007T094003Z_horn_replay_0074404a`, has the same TIFF SHA-256, pixel values
  including nodata, and mask; its recorded maximum pixel difference is **0°**.
  That verification was on **Linux / GDAL 3.10.3**. Windows and other GDAL
  environments were not executed or verified. No Zevenbergen–Thorne replay is
  claimed.

These differences compare algorithms, not accuracy against surveyed terrain.
The records are evidence from an earlier experiment, not a newly performed
Cumora computation.

## Input provenance and reproduction boundary

The source is **Copernicus DEM GLO-90 DSM**, AWS 2021 COG release, originally
3 arc-seconds (nominally 90 m). Before these runs it was bilinearly resampled onto
a **100 m grid**, stored as **Int16 whole metres**, and clipped using the earlier
OpenStreetMap Chongqing municipality boundary (relation 913069). This is a DSM,
not a bare-earth DTM or a native 100 m product. Coverage is the municipality, not
just Chongqing's traditional central nine districts.

The projected grid uses WGS84 Transverse Mercator, central meridian 108° E,
scale 1, false easting 500,000 m. Vertical metres and EGM2008 provenance are
inherited from the preserved source documentation; the input's two-dimensional
CRS and band do not encode the vertical datum/unit. No vertical transformation
was applied by the slope experiment.

**Exact replay starts at the preserved `chongqing_dem_100m.tif`.** It does not
claim reconstruction from the 30 original source tiles or a byte-exact rerun of
the earlier warp. Raw source tile hashes are unavailable. Earlier download
timestamps were retained as provenance and were not independently reverified.
This lightweight fixture cannot itself reproduce a raster because it omits all
raster bytes.

Public source references preserved in the fixture:

- [Copernicus DEM on AWS](https://registry.opendata.aws/copernicus-dem/)
- [GLO-90 AWS release readme](https://copernicus-dem-90m.s3.amazonaws.com/readme.html)
- [Copernicus DEM product description](https://dataspace.copernicus.eu/explore-data/data-collections/copernicus-contributing-missions/collections-description/COP-DEM)
- [OpenStreetMap boundary relation 913069](https://www.openstreetmap.org/relation/913069)

## Source-to-import mapping

The source directory is a separately preserved experiment named
`chongqing_slope_experiment`, not part of this repository. It contains
`deliverables.json`, the complete original input/run/replay TIFFs, and
`bundle/Chongqing_Slope_Experiment_20261007/`. The small reproducibility ZIP alone
does not contain those original TIFFs, so it is insufficient for the full
verification command below.

| Source file or field | Import use |
| --- | --- |
| `deliverables.json` → `archive.sha256`, `archive.bytes` | Verify the preserved reproducibility ZIP; retain its filename and SHA-256 in provenance. Ignore its local absolute paths. |
| `bundle/Chongqing_Slope_Experiment_20261007/bundle_manifest.json` | Verify the archived documents, code, manifests, and records before conversion. |
| `runs/<run-id>/metadata.json` | Run IDs, status, timestamps, input/output filenames, SHA-256 and sizes, parameters, environment versions, results and checks. |
| `runs/<run-id>/metadata.json` → `command_template` | `runs[].command`, unchanged. Never copy `command_argv` or `working_directory`. |
| `runs/<run-id>/code/run_slope.py` | `runs[].code` name, recorded SHA-256, and verified byte length. Always use each run's snapshot, not an assumed current root script. |
| `runs/<run-id>/stdout.txt`, `stderr.txt` | Actual log strings; exit code comes from `metadata.json.exit_status`. |
| `runs/<run-id>/manifest.json` | Verify the original metadata, code snapshot, logs, and output TIFF. |
| `provenance/input_provenance.json` | Dataset, public source URLs, prior processing, coverage, and reproduction limits. |
| `comparison_final/comparison.json` | Run pair and recorded metrics, flattened to English scalar keys with degree or km² suffixes; numeric values are unchanged. |
| `comparison_final/reproduction_verification.json` | Horn notes about the recorded replay's identity, equality checks, zero pixel difference and environment limitations. |
| `verification/<replay-id>/metadata.json`, `manifest.json` | Verify the preserved replay artifacts and its output SHA-256; do not add a synthetic third run. |
| `comparison_final/tile_manifest.json` | Also verify file SHA-256 and byte lengths of the eight available delivery TIFFs. Do not import them. |

Nested output statistics become `slope_<statistic>_degrees`; output counts and
boolean checks retain meaningful English names. Input pixel sizes become
`pixel_width_m` and `pixel_height_m`. Comparison statistic keys identify absolute
or signed differences and degree units. Human-friendly labels and explanatory
notes are editorial text; IDs, measurements, versions, command options, and logs
come from the records.

The converter allowlists fields and omits private absolute paths, executable
locations, Library IDs, and other unrelated identifiers. Original run IDs,
checksums and public dataset URLs remain. Run code hashes describe the preserved
Python snapshot, not this converter or Cumora's code.

## Regenerate and verify

Requires Python 3.10+ and the **complete original preserved experiment directory**.
No GDAL, NumPy, network access, new installation, or execution of saved commands
is involved. From the repository root, replace the quoted path with the local
experiment directory:

```sh
python3 examples/experiments/convert_chongqing.py '/path/to/chongqing_slope_experiment'
python3 examples/experiments/convert_chongqing.py '/path/to/chongqing_slope_experiment' --check
```

The first command verifies source hashes and regenerates the JSON. `--check`
performs the same verification and fails unless the existing JSON is
byte-for-byte identical; it does not write. Missing original artifacts or any
hash/size mismatch fail rather than silently substituting or inventing data.
`--output /path/to/fixture.json` selects another output file.

The converter verifies the archive against `deliverables.json`, every archived
manifest entry, original run/replay manifests, the preserved input, comparison
code, and delivery TIFF files. It confirms that source metadata/provenance and
comparison/replay records match their archived copies, and checks the run pair
and shared input. SHA-256 protects identity relative to these preserved records;
it is not an independent certification of their original provenance. Pixel
array hashes and statistics are not recomputed by this conversion step; pixel
identity is reported from the preserved replay verification.

### Verified fixture

The initial conversion and read-only `--check` both passed:

- **71 SHA-256 assertions across 63 distinct local files**; all checked lengths
  matched.
- **12,584 bytes**, below the existing **256 KiB** API request limit.
- SHA-256: `8c5ae00e757b1a45c6a5ae47a43373695abb548dbca33197d0d41bf7c6a4f342`
- No raster execution, Windows execution, or raw-source reconstruction was
  performed for this feature.

The generator also rejects oversized output and known private path/Library ID
markers. Its `--check` output prints the current size, digest, and verification
counts so changes are reviewable.

After `npm ci`, validate against the same runtime schema used by the UI/server:

```sh
node --import tsx --input-type=module -e "import {readFileSync} from 'node:fs'; import {parseExperimentBundle} from './shared/experiment-validation.ts'; const bundle = parseExperimentBundle(JSON.parse(readFileSync('examples/experiments/chongqing-slope.json', 'utf8'))); console.log(bundle.runs.length, bundle.comparisons.length)"
```

This check passed with two runs, one comparison, and all original microsecond
start/end timestamps preserved. JSON lint also passed. Full application and
integration testing is separate from these fixture-specific checks.
