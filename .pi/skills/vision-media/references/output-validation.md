# Visual Output Validation

## Image Validation

```python
def validate_image(path: str) -> dict:
    """Validate an image file's integrity and properties."""
    from PIL import Image
    img = Image.open(path)
    return {
        "format": img.format,
        "mode": img.mode,
        "size": img.size,
        "channels": len(img.getbands()),
        "valid": True,
    }
```

## Video Validation

```python
def validate_video(path: str) -> dict:
    """Validate a video file's integrity and properties."""
    import cv2
    cap = cv2.VideoCapture(path)
    fps = cap.get(cv2.CAP_PROP_FPS)
    frame_count = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    width = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    height = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    cap.release()
    return {
        "fps": fps,
        "frames": frame_count,
        "size": (width, height),
        "duration": frame_count / fps if fps > 0 else 0,
        "valid": True,
    }
```

## Mask Alignment Check

Always verify that masks have the same dimensions as their source images:

```python
def validate_mask_alignment(image_path: str, mask_path: str) -> bool:
    from PIL import Image
    img = Image.open(image_path)
    mask = Image.open(mask_path)
    return img.size == mask.size
```
