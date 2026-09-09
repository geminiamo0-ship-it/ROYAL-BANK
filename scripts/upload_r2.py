"""Upload Royal Bank media to Cloudflare R2.

Required environment variables:
  R2_ENDPOINT_URL
  R2_ACCESS_KEY_ID
  R2_SECRET_ACCESS_KEY
  R2_BUCKET_NAME
  R2_MEDIA_FOLDER

The script intentionally keeps credentials out of source control.
"""

from __future__ import annotations

import os

import boto3
from botocore.exceptions import ClientError


def require_env(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        raise RuntimeError(f"Missing required environment variable: {name}")
    return value


def upload_to_r2() -> None:
    endpoint_url = require_env("R2_ENDPOINT_URL")
    access_key = require_env("R2_ACCESS_KEY_ID")
    secret_key = require_env("R2_SECRET_ACCESS_KEY")
    bucket_name = require_env("R2_BUCKET_NAME")
    media_folder = os.path.abspath(require_env("R2_MEDIA_FOLDER"))

    if not os.path.isdir(media_folder):
        raise RuntimeError(f"R2_MEDIA_FOLDER is not a directory: {media_folder}")

    s3_client = boto3.client(
        "s3",
        endpoint_url=endpoint_url,
        aws_access_key_id=access_key,
        aws_secret_access_key=secret_key,
        region_name="auto",
    )

    success_count = 0
    error_count = 0
    print(f"Uploading media from {media_folder} to bucket {bucket_name}...")

    for root, _dirs, files in os.walk(media_folder):
        for filename in files:
            local_path = os.path.join(root, filename)
            relative_path = os.path.relpath(local_path, media_folder).replace("\\", "/")
            object_key = f"offline_media/{relative_path}"

            try:
                s3_client.upload_file(local_path, bucket_name, object_key)
                success_count += 1
                print(f"[OK] {object_key}")
            except ClientError as exc:
                error_count += 1
                print(f"[ERROR] {object_key}: {exc}")
            except Exception as exc:
                error_count += 1
                print(f"[ERROR] {object_key}: {exc}")

    print(f"Upload complete: {success_count} succeeded, {error_count} failed.")
    if error_count:
        raise RuntimeError(f"R2 upload completed with {error_count} failed file(s).")


if __name__ == "__main__":
    upload_to_r2()
