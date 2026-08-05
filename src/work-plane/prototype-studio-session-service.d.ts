export function createPrototypeStudioSessionService(input: { prototypeRoot: string }): {
  read(missionId: string): Readonly<Record<string, any>> | null;
  save(record: Readonly<Record<string, any>>): Readonly<Record<string, any>>;
  begin(input: { missionId: string; sourceProjectDesignVersion: number }): Readonly<Record<string, any>>;
};
