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
# Media Cutter sources: one per audio format, plus H.264/AAC video long enough to trim.
ffmpeg -f lavfi -i "sine=frequency=440:sample_rate=44100:duration=4" -ac 2 -c:a libmp3lame -b:a 128k tone-4s.mp3
ffmpeg -f lavfi -i "sine=frequency=440:sample_rate=44100:duration=4" -ac 2 -c:a flac -sample_fmt s16 tone-4s.flac
ffmpeg -f lavfi -i "sine=frequency=440:sample_rate=44100:duration=4" -ac 2 -c:a aac -b:a 96k tone-4s.m4a
ffmpeg -f lavfi -i "sine=frequency=440:sample_rate=44100:duration=4" -ac 2 -c:a vorbis -strict -2 tone-4s.ogg
ffmpeg -f lavfi -i testsrc=size=320x240:rate=24 -f lavfi -i sine=frequency=440:sample_rate=48000 -t 3 \
  -c:v libx264 -pix_fmt yuv420p -c:a aac -b:a 64k -movflags +faststart clip-3s-320x240.mp4
# FLAC decoder tests: lossless, so they must decode bit-exactly back to the golden WAVs.
ffmpeg -ss 26 -t 3 -i ../golden/audio/drop-30s-stereo.wav -c:a flac drop-3s-stereo.flac
ffmpeg -ss 26 -t 1 -i ../golden/audio/drop-30s-stereo.wav -c:a flac -sample_fmt s32 drop-1s-stereo-24.flac
ffmpeg -t 2 -i ../golden/audio/short-10s-mono.wav -c:a flac -compression_level 0 short-2s-mono.flac
# Preview fallback: Matroska, which WebKit can't play natively.
ffmpeg -f lavfi -i testsrc=size=320x240:rate=24 -f lavfi -i sine=frequency=440:sample_rate=48000 -t 3 \
  -c:v libx264 -pix_fmt yuv420p -c:a aac -b:a 64k clip-3s-320x240.mkv
```
