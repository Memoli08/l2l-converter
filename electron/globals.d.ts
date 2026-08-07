// ============================================================
// Ambient declarations for packages that ship no TypeScript types
// ============================================================

declare module "mammoth" {
  interface MammothResult {
    value: string;
    messages: unknown[];
  }
  interface MammothOptions {
    path?: string;
    buffer?: Buffer;
  }
  const mammoth: {
    convertToHtml(input: MammothOptions): Promise<MammothResult>;
    extractRawText(input: MammothOptions): Promise<MammothResult>;
  };
  export default mammoth;
}

declare module "ffprobe-static" {
  const ffprobeStatic: { path: string; version: string };
  export default ffprobeStatic;
}
