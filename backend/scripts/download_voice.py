import os
import urllib.request
from pathlib import Path

def download_file(url: str, dest: Path, min_size_mb: float = 0):
    print(f"Checking {dest.name}...")
    if dest.exists():
        size_mb = dest.stat().st_size / (1024 * 1024)
        if size_mb >= min_size_mb:
            print(f"  -> Already exists and size ({size_mb:.2f}MB) looks valid. Skipping.")
            return True
        else:
            print(f"  -> Exists but size ({size_mb:.2f}MB) is too small. Redownloading.")
            dest.unlink()
    
    print(f"  -> Downloading from {url}")
    try:
        urllib.request.urlretrieve(url, str(dest))
        size_mb = dest.stat().st_size / (1024 * 1024)
        print(f"  -> Downloaded successfully ({size_mb:.2f}MB)")
        if min_size_mb > 0 and size_mb < min_size_mb:
            print(f"  -> Error: Downloaded file is too small ({size_mb:.2f}MB < {min_size_mb}MB)")
            dest.unlink()
            return False
        return True
    except Exception as e:
        print(f"  -> Download failed: {e}")
        if dest.exists():
            dest.unlink()
        return False

def main():
    repo_url = "https://huggingface.co/rhasspy/piper-voices/resolve/v1.0.0/en/en_US/lessac/medium"
    model_name = "en_US-lessac-medium.onnx"
    json_name = f"{model_name}.json"
    
    backend_root = Path(__file__).parent.parent
    voices_dir = backend_root / "voices"
    voices_dir.mkdir(parents=True, exist_ok=True)
    
    print(f"Destination directory: {voices_dir.absolute()}")
    
    # The .onnx is typically ~40-60MB. We check for at least 40MB.
    onnx_ok = download_file(f"{repo_url}/{model_name}", voices_dir / model_name, min_size_mb=40.0)
    # JSON is very small, no size check
    json_ok = download_file(f"{repo_url}/{json_name}", voices_dir / json_name, min_size_mb=0)
    
    if onnx_ok and json_ok:
        print("\nAll Piper voice files downloaded successfully.")
    else:
        print("\nError downloading some files. TTS may not work.")

if __name__ == "__main__":
    main()
