import { v2 as cloudinary } from 'cloudinary';

import { env } from './env';

if (env.CLOUDINARY_URL) {
  cloudinary.config({ cloudinary_url: env.CLOUDINARY_URL });
}

export { cloudinary };

