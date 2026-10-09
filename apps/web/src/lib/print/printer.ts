/**
 * Printing abstraction. Version 1 prints through the browser (any printer the OS knows, including
 * thermal printers with a driver). The interface leaves room for native transports later:
 * ESC/POS over Web Serial / WebUSB / Web Bluetooth or a network printer bridge.
 */
export interface PrinterTransport {
  readonly id: 'browser' | 'escpos-usb' | 'escpos-bluetooth' | 'network';
  print(html: string, copies?: number): Promise<void>;
}

declare global {
  interface Window {
    /** Test hook: E2E tests capture printed documents instead of opening the print dialog. */
    __shopdeskPrintHook?: (html: string) => void;
  }
}

/** Repeat the document body `copies` times separated by page breaks. */
export function withCopies(html: string, copies: number): string {
  if (copies <= 1) return html;
  const match = /<body[^>]*>([\s\S]*)<\/body>/i.exec(html);
  if (!match) return html;
  const body = match[1]!;
  const repeated = Array.from({ length: copies }, () => body).join('<div style="page-break-before:always"></div>');
  return html.replace(body, repeated);
}

export class BrowserPrinter implements PrinterTransport {
  readonly id = 'browser' as const;

  print(html: string, copies = 1): Promise<void> {
    const document_ = withCopies(html, copies);
    if (window.__shopdeskPrintHook) {
      window.__shopdeskPrintHook(document_);
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const frame = document.createElement('iframe');
      frame.setAttribute('aria-hidden', 'true');
      frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden';
      document.body.appendChild(frame);
      const doc = frame.contentDocument!;
      doc.open();
      doc.write(document_);
      doc.close();
      const win = frame.contentWindow!;
      let finished = false;
      const done = () => {
        if (finished) return;
        finished = true;
        setTimeout(() => {
          frame.remove();
          resolve();
        }, 300);
      };
      win.addEventListener('afterprint', done);
      // Give images (UPI QR, logo) a moment to decode, then print. print() blocks until the
      // dialog closes in most browsers; done() is idempotent for those that don't.
      setTimeout(() => {
        win.focus();
        win.print();
        done();
      }, 250);
    });
  }
}

export const printer: PrinterTransport = new BrowserPrinter();

/** Open the document in a new window for preview / "Save as PDF". */
export function openPreview(html: string): void {
  const win = window.open('', '_blank', 'width=900,height=900');
  if (!win) return;
  win.document.open();
  win.document.write(html);
  win.document.close();
}
