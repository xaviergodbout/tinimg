# tinimg

tinimg is a small local image compressor/converter. It runs in your browser and does not upload files anywhere.

## Use it

Open `index.html` directly in Chrome, Edge, Firefox, or another modern browser.

You can also host the folder on GitHub Pages. It is a static app, so no server code is needed.
PWA install/offline support works when served over HTTPS, such as GitHub Pages, or from localhost. It will not work from a `file:///C:/.../index.html` URL.

To test PWA install locally:

```powershell
python -m http.server 8080
```

Then open `http://localhost:8080/`.

## Files

- `index.html` - app markup
- `css/styles.css` - app styling
- `js/app.js` - compressor, download, and UI logic
- `manifest.webmanifest` - PWA metadata
- `sw.js` - offline cache service worker
- `assets/icons/` - favicon and install icons

## What it does

- Add one image or a batch of images.
- See each original file size in the input side.
- Pick a goal using KB, MB, or % from the unit dropdown.
- When images are added, tinimg sets the size goal to 50% of the average input size by default.
- Pick an output format: JPG, PNG, or WebP.
- Press Compress all, or use the arrow on one image, and each processed image moves from input to output as it finishes.
- Click output images to select them.
- Download one image, selected images, or the whole output batch.
- Before saving, choose original dimensions, 4K, 2K, or 1080p when that size would not upscale the image.

Browser image support varies. JPG, PNG, and WebP are usually fine in current Chrome/Edge. Some formats such as HEIC or TIFF may not decode without browser support.

Canvas-based conversion removes image metadata such as EXIF.
