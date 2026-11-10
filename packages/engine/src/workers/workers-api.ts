// The workers area's public API (the job queue, the worker pool and its protocol), re-exported
// by the package entry, src/index.ts, which would otherwise pass 400 lines.
export { createDecodeJobHandler } from './decode-job.js';
export type { DecodedImage, DecodeJobOptions, ImageBitmapFactory } from './decode-job.js';
export { createDefaultJobHandlers } from './default-job-handlers.js';
export { framesJob } from './frames-job.js';
export { createProductionJobHandlers } from './production-job-handlers.js';
export type { ProductionJobOptions } from './production-job-handlers.js';
export { chooseWorkerCount, DEFAULT_MAX_WORKERS, detectWorkerEnvironment } from './environment.js';
export type { WorkerEnvironment, WorkerHost } from './environment.js';
export { JobCancelledError, JobFailedError } from './job-errors.js';
export { resourceContext } from './job-handlers.js';
export type {
  JobContext,
  JobHandler,
  JobHandlers,
  JobOutcome,
  RegisteredJobHandler,
} from './job-handlers.js';
export type { JobId } from './job-id.js';
export type {
  DecodedLevel,
  DecodeJobRequest,
  DecodeJobResponse,
  EchoJobRequest,
  EchoJobResponse,
  FramesJobFrame,
  FramesJobRequest,
  FramesJobResponse,
  JobKind,
  JobPayloads,
  JobRequest,
  JobResponse,
  JobSignature,
} from './job-kinds.js';
export { JOB_PRIORITIES } from './job-priority.js';
export type { JobPriority } from './job-priority.js';
export type {
  JobResource,
  JobTicket,
  PendingJob,
  SubmitOptions,
  SubmittedJob,
  SubmittedJobOf,
} from './job-submission.js';
export { PriorityJobQueue } from './priority-job-queue.js';
export type { PriorityClassifier, QueuedJob } from './priority-job-queue.js';
export {
  createJobRequestMessage,
  isJobReplyMessage,
  isJobRequestMessage,
  isWorkerFaultMessage,
} from './protocol.js';
export type {
  JobErrorMessage,
  JobFailure,
  JobFailureCode,
  JobReplyMessage,
  JobRequestMessage,
  JobRequestMessageOf,
  JobResultMessage,
  PostedMessage,
  TransferList,
  WorkerFaultMessage,
} from './protocol.js';
export { createBrowserBitmapFactory } from './web-worker/browser-bitmap-factory.js';
export type {
  BitmapScope,
  WebDecodedImage,
  WebImageBitmapFactory,
} from './web-worker/browser-bitmap-factory.js';
export { createBrowserColourCanvas } from './web-worker/browser-colour-canvas.js';
export type {
  ColourCanvasScope,
  WebColourCanvasFactory,
} from './web-worker/browser-colour-canvas.js';
export { createWebWorkerTransport, serveWorkerEntry } from './web-worker/web-worker-transport.js';
export type {
  WebWorkerEntry,
  PageLeaveScope,
  WebWorkerPoster,
  WebWorkerTransport,
  WebWorkerTransportListener,
} from './web-worker/web-worker-transport.js';
export { WorkQueue } from './work-queue.js';
export type { DrainReport, JobRunner } from './work-queue.js';
export { createWorkerEntry } from './worker-entry.js';
export type { ReplyPoster, WorkerEntry } from './worker-entry.js';
export { WorkerPool } from './worker-pool.js';
export type { WorkerPoolOptions } from './worker-pool.js';
export type {
  WorkerTransport,
  WorkerTransportFactory,
  WorkerTransportListener,
} from './worker-transport.js';
