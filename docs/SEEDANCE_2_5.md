# Seedance 2.5 integration (fal)

The backend exposes two separate, documented fal queue endpoints:

- [Text to video](https://fal.ai/models/bytedance/seedance-2.5/text-to-video/api): `bytedance/seedance-2.5/text-to-video`, operation `text_to_video`.
- [Reference to video](https://fal.ai/models/bytedance/seedance-2.5/reference-to-video/api): `bytedance/seedance-2.5/reference-to-video`, operation `reference_to_video`.

Accepted request controls are `durationSec` (`"auto"` or an integer from 4 through 30), `aspectRatio` (`auto`, `21:9`, `16:9`, `4:3`, `1:1`, `3:4`, `9:16`), `resolution` (`480p`, `720p`, `1080p`), `audio` (boolean), and `bitrateMode` (`standard`, `high`). Omitting a control preserves the provider default. The `/api` schema is used for these allowed values; fal's accompanying overview table still omits 1080p even though its live API schema lists it.

Reference requests also accept `imageUrls`, `videoUrls`, and `audioUrls`. At least one image or video is required; fal allows up to 30 images, 10 videos, 10 audio files, and 50 total files. The backend checks counts and public HTTPS URL syntax. The provider also limits each video's format, size, duration, dimensions and frame rate and each audio file's format, size and duration. Those properties cannot be validated from URL strings alone and are enforced by fal during submission. Reference prompts address assets in list order as `@Image1`, `@Video1`, `@Audio1`, per the current `/api` schema.

Fal bills by output frame area and duration. Its [published pricing explanation](https://fal.ai/models/bytedance/seedance-2.5/reference-to-video) says that video references also bill input video seconds, at a 0.6 multiplier when a video reference exists; images and audio references add no billed seconds. Approximate 16:9 output rates are $0.22/s at 480p, $0.47/s at 720p and $1.16/s at 1080p, subject to provider/account pricing. A numeric estimate is returned only for fixed 480p/720p duration and aspect ratio without a video reference. Auto settings, 1080p, and unknown input video durations return no numeric estimate. Generated audio does not change the provider's token price.

Queue submission and polling are covered with mocked tests. No paid generation was run, so access to these partner endpoints and exact account charges remain unverified.
