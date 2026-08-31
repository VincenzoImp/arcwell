export interface CommandIo {
  stdout(text: string): void;
  stderr(text: string): void;
}
