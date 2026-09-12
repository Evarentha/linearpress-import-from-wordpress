# Import from WordPress

[![LinearPress](https://img.shields.io/badge/LinearPress-plugin-7C3AED.svg)](https://www.npmjs.com/package/@evarentha/linearpress) [![npm](https://img.shields.io/npm/v/@evarentha/linearpress-import-from-wordpress.svg)](https://www.npmjs.com/package/@evarentha/linearpress-import-from-wordpress) [![Node.js](https://img.shields.io/badge/node-%3E%3D22-green.svg)](https://nodejs.org) [![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue.svg)](https://www.typescriptlang.org) [![License: GPL-3.0-or-later](https://img.shields.io/badge/License-GPL--3.0--or--later-blue.svg)](LICENSE)

**English** | [简体中文](README.zh-CN.md)

Move a WordPress site into LinearPress from its WXR export XML: posts, pages, media, users, categories, comments, and site info, under "keep existing, overwrite conflicts" semantics (a post with the same slug is overwritten, everything else is left alone), so the import can run on a live site. The import cannot be aborted once running, and the site stays in maintenance mode for other visitors until it finishes.

## Install

```bash
git clone https://github.com/Evarentha/linearpress-import-from-wordpress.git src/plugins/import-from-wordpress
```

The directory name must equal the plugin id. Restart afterwards, or sync from the `base` checkout (`sh scripts/sync-plugins.sh import-from-wordpress`), or upload the ZIP / npm name from the admin Plugins page. This is a backend-only plugin; the import page is guarded by the base `plugin:manage` permission and it defines none of its own.

Optional partners for full fidelity: media-library, advanced-posts-list, colorful-profiles. Each is checked at runtime, and a missing one just means that step is skipped.

## Running an import

First export from WordPress: admin, Tools, Export, All content, save the XML (64 MB at most). Then in the LinearPress admin, open Plugins and click this plugin's settings button ("自定义设置") to reach `/admin/import-from-wordpress`, pick the file, choose the options, and start.

The import runs as a background task, typically 5 to 10 minutes depending on volume, while the progress page polls every 1.2 seconds. Progress is visible only to the session that started the import (also exposed as JSON at `/admin/import-from-wordpress/progress.json`); everyone else sees the ordinary maintenance page. Do not restart or redeploy mid-import. An interrupted import can be retried and resumes where it left off: `ifwp_media_map`, a table in the infrastructure database, maps each old WordPress media URL to its new LinearPress URL, so attachments are not re-downloaded.

During the import the site runs in maintenance mode for other visitors, but plugin management is locked: no plugin is disabled or uninstalled mid-import, because the import needs the partner plugins.

## What gets imported

The WXR parser, the multipart upload parser, and the Gutenberg block converter are all written inside this plugin, with no XML libraries pulled in. Paragraph, heading, quote, image, and verse blocks become native LinearPress blocks; every other block is preserved as custom-html. The `views` postmeta becomes the post's view count, and sticky flags are honored.

Writes go through public services (`ctx.posts`, `ctx.users`, the media library), so core routes and core tables stay untouched. Imported WordPress authors become archive-only accounts with random bcrypt passwords, assigned to a subscriber group, so they cannot be used to log in. Comments keep their author, email, IP, and timestamps; WordPress-approved comments land as approved, the rest as pending review. Site info (name, subtitle, description, URL) is applied through `ctx.config.set` and skipped when the domain autoDetect mode is on.

Partner steps and their fallbacks:

| Step | Partner plugin | Without it |
| --- | --- | --- |
| Media | media-library | Attachments are not downloaded; original links are kept |
| Categories | advanced-posts-list | Categories are not imported |
| Author profiles | colorful-profiles | Only the username and email are imported; the account gets a randomly generated password |

With media-library present, attachments land in `uploads/<kind>s/Y/M/D` and media URLs inside the content are rewritten, `-1024x896` and `-scaled` variants included. With advanced-posts-list present, categories land in `apl_categories`, post links in `apl_post_categories`, sticky flags in `apl_post_options`. With colorful-profiles present, author nicknames are synced into `colorful_profiles`.

## FAQ

**The import was interrupted. What now?** Run it again. `ifwp_media_map` remembers which media URLs were already downloaded, so retries resume from where the previous run stopped instead of re-downloading attachments.

**Will it overwrite my existing posts?** Semantics are "keep existing, overwrite conflicts": a post with the same slug is overwritten by the imported content; posts without a matching slug are left alone.

**Can visitors use the site during an import?** They see the ordinary maintenance page; only the session that started the import sees progress. Do not restart or redeploy mid-import.

## License

GPL-3.0-or-later, Copyright (C) 2026 Evarentha. See LICENSE.
