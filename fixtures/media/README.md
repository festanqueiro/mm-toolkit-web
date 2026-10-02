# Media fixtures

Small inputs for decode/validation tests (not desktop-generated, unlike `../golden/`).
Regenerate with FFmpeg:

```bash
# VP9 at 320×240: WebKit/Firefox on macOS refuse to decode VP9 as small as 64×48.
ffmpeg -f lavfi -i testsrc=size=320x240:rate=12 -f lavfi -i sine=frequency=440:sample_rate=48000 -t 1 \
  -c:v libvpx-vp9 -b:v 60k -pix_fmt yuv420p -c:a libopus -b:a 32k clip-320x240.webm
ffmpeg -f lavfi -i testsrc=size=64x48:rate=12 -t 1 -c:v libx264 -pix_fmt yuv420p clip-64x48.mp4
ffmpeg -i ../golden/audio/short-10s-mono.wav -c:a pcm_s16be short-10s-mono.aiff
printf 'not an image' > broken.png
# Render tests: encoders reject very small frames, so use 320×240.
ffmpeg -f lavfi -i testsrc=size=320x240 -frames:v 1 visual-320x240.png
```
