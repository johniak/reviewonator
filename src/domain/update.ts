export type UpdateNotice = { current: string; latest: string; releaseUrl: string };

export interface UpdateNoticeSource {
  notice(): Promise<UpdateNotice | null>;
  dismiss(version: string): Promise<void>;
}
