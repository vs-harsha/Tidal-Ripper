/**
 * Songlink API utilities for converting streaming links between platforms
 */

export interface SonglinkResponse {
	entityUniqueId: string;
	userCountry: string;
	pageUrl: string;
	entitiesByUniqueId: Record<string, SonglinkEntity>;
	linksByPlatform: Record<string, SonglinkPlatformLink>;
}

export interface SonglinkEntity {
	id: string;
	type: 'song' | 'album';
	title?: string;
	artistName?: string;
	thumbnailUrl?: string;
	thumbnailWidth?: number;
	thumbnailHeight?: number;
	apiProvider: string;
	platforms: string[];
}

export interface SonglinkPlatformLink {
	country: string;
	url: string;
	nativeAppUriMobile?: string;
	nativeAppUriDesktop?: string;
	entityUniqueId: string;
}

export interface TidalInfo {
	type: 'track' | 'album' | 'playlist';
	id: string;
	url: string;
}

/**
 * Supported streaming platforms
 */
export const SUPPORTED_PLATFORMS = [
	{ id: 'spotify', name: 'Spotify', pattern: /spotify\.com\/(track|album|playlist)/ },
	{ id: 'appleMusic', name: 'Apple Music', pattern: /music\.apple\.com/ },
	{ id: 'youtubeMusic', name: 'YouTube Music', pattern: /music\.youtube\.com/ },
	{ id: 'deezer', name: 'Deezer', pattern: /deezer\.com\/(track|album|playlist)/ },
	{ id: 'soundcloud', name: 'SoundCloud', pattern: /soundcloud\.com/ },
	{ id: 'tidal', name: 'TIDAL', pattern: /tidal\.com\/(browse\/)?(track|album|playlist)/ },
	{ id: 'amazon', name: 'Amazon Music', pattern: /music\.amazon\.com/ },
	{ id: 'pandora', name: 'Pandora', pattern: /pandora\.com/ }
] as const;

/**
 * Detect if URL is from a supported streaming platform
 */
export function isSupportedStreamingUrl(url: string): boolean {
	try {
		const parsedUrl = new URL(url);
		return SUPPORTED_PLATFORMS.some((platform) => platform.pattern.test(parsedUrl.href));
	} catch {
		return false;
	}
}

/**
 * Detect if URL is a Spotify playlist
 */
export function isSpotifyPlaylistUrl(url: string): boolean {
	try {
		const parsedUrl = new URL(url);
		return /spotify\.com\/playlist/.test(parsedUrl.href);
	} catch {
		return false;
	}
}

/**
 * Extract TIDAL information from Songlink response
 */
export function extractTidalInfo(response: SonglinkResponse): TidalInfo | null {
	// Find TIDAL link in linksByPlatform
	const tidalLink = response.linksByPlatform.tidal;
	if (!tidalLink?.url) {
		return null;
	}

	// Parse TIDAL URL to extract type and ID
	const url = tidalLink.url;
	const match = url.match(/tidal\.com\/(?:browse\/)?(\w+)\/(\d+)/);

	if (!match) {
		return null;
	}

	const [, type, id] = match;

	// Map Songlink types to our types
	let tidalType: 'track' | 'album' | 'playlist';
	if (type === 'track' || type === 'song') {
		tidalType = 'track';
	} else if (type === 'album') {
		tidalType = 'album';
	} else if (type === 'playlist') {
		tidalType = 'playlist';
	} else {
		return null;
	}

	// Validate that the ID is numeric
	const numericId = Number(id);
	if (!Number.isFinite(numericId) || numericId <= 0) {
		console.warn('TIDAL ID is not a valid number:', id);
		return null;
	}

	return {
		type: tidalType,
		id,
		url
	};
}

/**
 * Detect the country code from an Apple Music (or other) streaming URL.
 * e.g. https://music.apple.com/in/song/... → 'IN'
 *      https://music.apple.com/us/song/... → 'US'
 * Returns null if no country segment is found.
 */
export function detectCountryFromUrl(url: string): string | null {
	try {
		const parsed = new URL(url);
		// Apple Music: music.apple.com/{cc}/...
		if (parsed.hostname === 'music.apple.com') {
			const cc = parsed.pathname.split('/').filter(Boolean)[0];
			if (cc && cc.length === 2) return cc.toUpperCase();
		}
		return null;
	} catch {
		return null;
	}
}

/**
 * Fetch Songlink data for a given URL
 */
export async function fetchSonglinkData(
	url: string,
	options?: {
		userCountry?: string;
		songIfSingle?: boolean;
	}
): Promise<SonglinkResponse> {
	const params = new URLSearchParams();
	params.set('url', url);

	if (options?.userCountry) {
		params.set('userCountry', options.userCountry);
	}

	if (options?.songIfSingle !== undefined) {
		params.set('songIfSingle', options.songIfSingle.toString());
	}

	// Randomly prefer backup API 50% of the time for load balancing
	const preferBackup = Math.random() < 0.5;
	if (preferBackup) {
		params.set('preferBackup', 'true');
	}

	const apiUrl = `/api/songlink?${params.toString()}`;

	const response = await fetch(apiUrl);

	if (!response.ok) {
		const error = await response.json().catch(() => ({ error: 'Unknown error' }));
		throw new Error(error.error || `Failed to fetch Songlink data: ${response.status}`);
	}

	return response.json();
}

/**
 * Convert a streaming platform URL to TIDAL information.
 * Auto-detects country from the URL when not provided.
 */
export async function convertToTidal(
	url: string,
	options?: {
		userCountry?: string;
		songIfSingle?: boolean;
	}
): Promise<TidalInfo | null> {
	try {
		const country = options?.userCountry ?? detectCountryFromUrl(url) ?? 'US';
		const songlinkData = await fetchSonglinkData(url, { ...options, userCountry: country });
		return extractTidalInfo(songlinkData);
	} catch (error) {
		console.error('Failed to convert URL to TIDAL:', error);
		return null;
	}
}

/**
 * Like convertToTidal but also returns the source entity (title/artist)
 * so callers can fall back to a direct TIDAL search when no TIDAL link exists.
 */
export async function convertToTidalWithFallback(
	url: string,
	options?: { userCountry?: string; songIfSingle?: boolean }
): Promise<{ tidalInfo: TidalInfo | null; fallbackTitle?: string; fallbackArtist?: string }> {
	try {
		const country = options?.userCountry ?? detectCountryFromUrl(url) ?? 'US';
		const songlinkData = await fetchSonglinkData(url, { ...options, userCountry: country });
		const tidalInfo = extractTidalInfo(songlinkData);
		if (tidalInfo) return { tidalInfo };

		// No TIDAL link found — extract source entity for fallback search
		const primaryEntity = songlinkData.entitiesByUniqueId[songlinkData.entityUniqueId];
		return {
			tidalInfo: null,
			fallbackTitle: primaryEntity?.title,
			fallbackArtist: primaryEntity?.artistName
		};
	} catch (error) {
		console.error('Failed to convert URL to TIDAL:', error);
		return { tidalInfo: null };
	}
}

/**
 * Get platform name from URL
 */
export function getPlatformName(url: string): string | null {
	try {
		const parsedUrl = new URL(url);
		const platform = SUPPORTED_PLATFORMS.find((p) => p.pattern.test(parsedUrl.href));
		return platform?.name || null;
	} catch {
		return null;
	}
}

/**
 * Convert a Spotify playlist to an array of track URLs for Songlink conversion
 */
export async function convertSpotifyPlaylist(playlistUrl: string): Promise<string[]> {
	// Strip query parameters from the URL
	let cleanUrl = playlistUrl;
	try {
		const url = new URL(playlistUrl);
		cleanUrl = `${url.origin}${url.pathname}`;
	} catch (e) {
		// If URL parsing fails, use original URL
		console.warn('Failed to parse playlist URL, using as-is:', e);
	}

	const response = await fetch('/api/spotify-playlist', {
		method: 'POST',
		headers: {
			'Content-Type': 'application/json'
		},
		body: JSON.stringify({ playlistUrl: cleanUrl })
	});

	if (!response.ok) {
		const error = await response.json().catch(() => ({ error: 'Unknown error' }));
		throw new Error(error.error || `Failed to fetch Spotify playlist: ${response.status}`);
	}

	const data = await response.json();
	return data.songLinks;
}

/**
 * Extract TIDAL song entity from Songlink response for display
 * Prioritizes the entityUniqueId, then falls back to any TIDAL_SONG entity
 */
export function extractTidalSongEntity(response: SonglinkResponse): SonglinkEntity | null {
	// First try the primary entity if it's a TIDAL song
	const primaryEntity = response.entitiesByUniqueId[response.entityUniqueId];
	if (primaryEntity?.apiProvider === 'tidal') {
		return primaryEntity;
	}

	// Fallback: find any TIDAL_SONG entity
	const tidalKey = Object.keys(response.entitiesByUniqueId).find((key) =>
		key.startsWith('TIDAL_SONG::')
	);

	return tidalKey ? response.entitiesByUniqueId[tidalKey] || null : null;
}
