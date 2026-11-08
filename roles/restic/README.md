# restic

Backs up NAS folders to Backblaze B2 with [restic](https://restic.net),
using the [resticker](https://github.com/djmaze/resticker) image.
Everything is encrypted on the NAS before upload, so Backblaze only holds
ciphertext.

Each entry in `restic_backups` (`defaults/main.yml`) gets two containers:

| Container | Runs | Does |
|---|---|---|
| `restic-<name>` | Daily 03:30 | `restic backup`, then keeps the last 10 daily snapshots and prunes the rest |
| `restic-<name>-check` | Sundays 05:00 | `restic check`, re-reading a random 10% of the data from B2 |

An entry can set its own `cron`, `check_cron` and `keep` (restic `forget`
options). Either container posts to the ntfy topic `backups` when it fails;
subscribe to `backups` in the ntfy app.

## Backups

| Name | Folder | Repository |
|---|---|---|
| `apple-health` | `health_raw_directory` (Health Auto Export payloads, written by n8n) | `b2:northview-health-raw:health-raw` |

## Adding a backup

Done by hand, then one entry:

1. **Backblaze bucket:** private, Object Lock off. In its Lifecycle Settings
   choose **Keep only the last version of the file**, so files restic prunes
   don't linger as hidden versions and use up the free 10 GB.
2. **Application key** limited to that bucket, read and write.
3. **Vault:** the key's ID and value, and a long random restic password
   (`openssl rand -base64 32`), mapped in `vars/main.yml` as
   `restic_<name>_b2_key_id`, `restic_<name>_b2_key` and
   `restic_<name>_password` (with `-` as `_`). Use a new password per backup. **Without it the
   backup can't be read.** The copy in the vault is the recovery key, so keep
   the vault password safe too.
4. **Entry** in `restic_backups` with `name`, `source`, `repository`
   (`b2:<bucket>:<path>`) and the three variables, then run
   `ansible-playbook playbook.yml --tags restic`. resticker creates the
   repository on first start.

## Useful commands

On the NAS (`sudo /usr/local/bin/docker ...`):

```sh
docker exec restic-apple-health restic snapshots       # list backups
docker exec restic-apple-health restic stats --mode raw-data
docker exec restic-apple-health backup                 # back up now
docker logs restic-apple-health
```

## Restoring

From the NAS, into a new folder (never straight over the live one):

```sh
docker exec restic-apple-health restic restore latest --target /root/.cache/restic/restore
```

The files land in `{{ config_directory }}/restic/apple-health/restore/`.

If the NAS is gone, restore from the Mac with `brew install restic`, using
the key and password from the vault:

```sh
export B2_ACCOUNT_ID=... B2_ACCOUNT_KEY=... RESTIC_PASSWORD=...
restic -r b2:northview-health-raw:health-raw restore latest --target ~/health-raw-restore
```
