// ACP process shutdown allows 2 s for TERM, then 2 s to observe the killed
// process group. Each SDK owner must outlive that cleanup and its inner owner.
export const sdkShutdownGraceMs=6000;
export const sdkWorkerShutdownGraceMs=sdkShutdownGraceMs+1000;
export const sdkServiceShutdownGraceMs=sdkWorkerShutdownGraceMs+1000;
