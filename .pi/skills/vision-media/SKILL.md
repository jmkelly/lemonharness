---
name: vision-media
description: >
  Computer vision and media processing: CLI interface stability,
  coordinate alignment (row-major vs column-major), shape consistency
  after transformations, and output validation. Use for image processing,
  video analysis, object detection, segmentation.
---

# Vision Media

**Leading word:** _alignment_ — coordinates, dimensions, channels, and color spaces must be aligned between input and output. A misaligned pixel is a silent bug.

## Rules

1. **CLI stability** — When using CLI tools (`ffmpeg`, ImageMagick, OpenCV CLI), verify the output format before further processing. Don't assume the tool produced what you asked for.
2. **Coordinate alignment** — Ensure coordinates, dimensions, and masks are properly aligned between input and output. Verify shape consistency after every transformation.
3. **Output validation** — Always verify generated images/videos: check dimensions, color channels, and file integrity before declaring success.
4. **Coordinate conventions** — Be explicit: row-major vs column-major, y-up vs y-down, center vs corner. State the convention once and keep it consistent.

## Setup

```bash
pip install opencv-python pillow matplotlib numpy
```

Output validation procedures: [`references/output-validation.md`](references/output-validation.md)

---

## Pseudocode

```
SKILL vision-media

INPUTS:
  mediaType: string         // image, video, mask, segmentation
  inputFormat: string       // png, jpg, mp4, nifti, dicom
  processingOp: string      // transform, detect, segment, classify
  dimensions?: object       // Expected width, height, channels

OUTPUTS:
  processedMedia: binary    // Processed image/video data
  validationReport: object
  //   dimensions_match: bool
  //   color_channels: int
  //   file_integrity: bool
  coordinateSystem: string  // row-major or col-major, y-up or y-down

PRECONDITIONS:
  - Input file integrity confirmed before processing
  - Coordinate system explicitly declared
  - Output format compatible with intended use

POSTCONDITIONS:
  - Output dimensions match expected specification
  - Color channels preserved or explicitly converted
  - File integrity verified after processing
  - Coordinate convention consistent between input and output

ERROR_HANDLING:
  - Input file corrupt → abort with integrity report
  - Dimension mismatch → reshape or error with details
  - CLI tool produces unexpected output → re-verify format
```
