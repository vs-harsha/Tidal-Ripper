import type { LayoutServerLoad } from './$types';
import { env } from '$env/dynamic/private';

export const load: LayoutServerLoad = () => {
	return {
		title: env.TITLE ?? 'VelvetTone',
		slogan: env.SLOGAN ?? 'Premium lossless audio. Refined down to every bit.'
	};
};
