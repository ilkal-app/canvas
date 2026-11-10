// The assets client's types the package exports (`PageImages.request` hands its call
// the client), re-exported together so the package's entry stays one line for them.
export type {
  AssetAccess,
  AssetsFetch,
  AssetsHttp,
  Declaration,
  DeclaredImage,
  LinkPreview,
} from './assets-http.js';
