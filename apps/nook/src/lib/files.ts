// Getting files off the device: the share sheet on phones, downloads elsewhere.

/**
 * Share files, or download them where sharing isn't available.
 * 'retry' means the browser wanted a fresh tap (Safari lets a share sheet open
 * only right after one, and rendering may have taken longer than that).
 */
export async function shareFiles(files: File[]): Promise<'shared' | 'cancelled' | 'downloaded' | 'retry'> {
  if (navigator.canShare?.({ files })) {
    try {
      await navigator.share({ files });
      return 'shared';
    } catch (e) {
      if (e instanceof DOMException && e.name === 'AbortError') return 'cancelled'; // user closed the sheet
      if (e instanceof DOMException && e.name === 'NotAllowedError') return 'retry';
    }
  }
  downloadFiles(files);
  return 'downloaded';
}

/** Save files straight to the device's downloads, skipping the share sheet. */
export function downloadFiles(files: File[]): void {
  for (const [i, file] of files.entries()) {
    const url = URL.createObjectURL(file);
    // Browsers drop rapid back-to-back downloads; space them out a little.
    setTimeout(() => {
      Object.assign(document.createElement('a'), { href: url, download: file.name }).click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }, i * 250);
  }
}

export async function shareOrDownload(name: string, text: string, type: string): Promise<void> {
  await shareFiles([new File([text], name, { type })]);
}
