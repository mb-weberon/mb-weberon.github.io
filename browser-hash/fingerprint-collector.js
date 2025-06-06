// fingerprint-collector.js

/**
 * Parses the user agent string to extract browser name, version, and OS.
 * @param {string} ua - The user agent string.
 * @returns {{browserName: string, browserVersion: string, os: string}}
 */
function parseUserAgent(ua) {
    let browserName = 'Unknown';
    let browserVersion = 'Unknown';
    let os = 'Unknown';

    // Detect OS
    if (ua.includes('Windows NT')) os = 'Windows';
    else if (ua.includes('Mac OS X')) os = 'macOS';
    else if (ua.includes('Android')) os = 'Android';
    else if (ua.includes('iOS') || ua.includes('iPhone') || ua.includes('iPad')) os = 'iOS';
    else if (ua.includes('Linux')) os = 'Linux';

    // Detect Browser
    let match;
    if ((match = ua.match(/(Edg|Edge)\/([\d.]+)/i))) { browserName = 'Edge'; browserVersion = match[2].split('.')[0];}
    else if ((match = ua.match(/Firefox\/([\d.]+)/i))) { browserName = 'Firefox'; browserVersion = match[1].split('.')[0];}
    else if ((match = ua.match(/Chrome\/([\d.]+)/i)) && !ua.includes("Chromium")) { browserName = 'Chrome'; browserVersion = match[1].split('.')[0];}
    else if ((match = ua.match(/Safari\/([\d.]+)/i)) && !ua.includes("Chrome") && !ua.includes("Chromium")) { browserName = 'Safari'; if ((match = ua.match(/Version\/([\d.]+)/i))) { browserVersion = match[1].split('.')[0]; }}
    else if ((match = ua.match(/OPR\/([\d.]+)/i)) || (match = ua.match(/Opera\/([\d.]+)/i))) { browserName = 'Opera'; browserVersion = match[1].split('.')[0];}
    return { browserName, browserVersion, os };
}

/**
 * Generates a canvas fingerprint by drawing text and shapes and converting to a data URL.
 * @returns {Promise<string>} A promise that resolves with the canvas data URL or an error string.
 */
function getCanvasFingerprint() {
    return new Promise((resolve) => {
        try {
            const canvas = document.createElement('canvas');
            canvas.width = 200; canvas.height = 50;
            const ctx = canvas.getContext('2d');
            if (!ctx) { resolve('canvas-unsupported'); return; }
            ctx.textBaseline = 'top'; ctx.font = '14px "Arial"';
            ctx.fillStyle = '#f60'; ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.fillStyle = '#069'; ctx.fillText('BrowserFingerprint.js <canvas> 1.0', 2, 2);
            resolve(canvas.toDataURL('image/png'));
        } catch (e) {
            console.error("Canvas fingerprinting error:", e);
            resolve('canvas-error');
        }
    });
}

/**
 * Generates an audio fingerprint by examining Web Audio API properties.
 * @returns {Promise<string>} A promise that resolves with a string representing the audio fingerprint or an error string.
 */
function getAudioFingerprint() {
    return new Promise(resolve => {
        const AudioContext = window.AudioContext || window.webkitAudioContext;
        if (!AudioContext) {
            resolve('audio-unsupported');
            return;
        }

        let context;
        try {
            context = new AudioContext();
            const compressor = context.createDynamicsCompressor();
            const analyser = context.createAnalyser();
            const oscillator = context.createOscillator();

            // Collect various parameters from the audio context and nodes
            // These values can vary slightly depending on OS, hardware, and browser implementation
            const audioFeatures = [
                `context_sampleRate:${context.sampleRate}`,
                `compressor_threshold:${compressor.threshold.value}`,
                `compressor_knee:${compressor.knee.value}`,
                `compressor_ratio:${compressor.ratio.value}`,
                `compressor_attack:${compressor.attack.value}`,
                `compressor_release:${compressor.release.value}`,
                `analyser_fftSize:${analyser.fftSize}`,
                `analyser_minDecibels:${analyser.minDecibels}`,
                `analyser_maxDecibels:${analyser.maxDecibels}`,
                `analyser_smoothingTimeConstant:${analyser.smoothingTimeConstant}`,
                `oscillator_type:${oscillator.type}`,
                `oscillator_frequency:${oscillator.frequency.value}`,
                `oscillator_detune:${oscillator.detune.value}`
            ].join(';');

            // Close the audio context to release resources
            if (context.state !== 'closed') {
                context.close().then(() => resolve(audioFeatures)).catch(e => {
                    console.error("Error closing audio context:", e);
                    resolve(audioFeatures + '-context-close-error'); // Still return features but indicate close error
                });
            } else {
                resolve(audioFeatures);
            }

        } catch (e) {
            console.error("Audio fingerprinting error:", e);
            // Ensure context is closed if it was opened before the error
            if (context && context.state !== 'closed') {
                context.close().finally(() => resolve('audio-error'));
            } else {
                resolve('audio-error');
            }
        }
    });
}

/**
 * Generates a conceptual DRM-related fingerprint.
 * This is highly conceptual as direct access to unique DRM identifiers is restricted.
 * It checks for the availability of Media Key System Access and returns a string based on supported systems.
 * @returns {Promise<string>} A promise that resolves with a string indicating DRM support or its absence.
 */
async function getDrmFingerprint() {
    if (!navigator.requestMediaKeySystemAccess) {
        return 'drm-api-unsupported'; // No API available
    }

    const keySystemsToTest = [
        // Common key systems, for conceptual demonstration only.
        // Actual support varies greatly by browser, OS, and content licenses.
        'com.google.youtube.playready',
        'org.w3.clearkey',
        'com.microsoft.playready',
        // 'com.apple.fps.1_0' // Apple FairPlay Streaming is highly restricted and usually requires specific hardware and certificates.
    ];

    let supportedKeySystems = [];

    for (const keySystem of keySystemsToTest) {
        try {
            // Attempt to query support for a simple, generic configuration
            // Note: This does NOT grant access, only checks for reported support.
            const supported = await navigator.requestMediaKeySystemAccess(keySystem, [{
                initDataTypes: ['cenc', 'webm', 'mp4'], // Common init data types
                videoCapabilities: [{ contentType: 'video/mp4; codecs="avc1.42E01E"' }], // Common video codec
                audioCapabilities: [{ contentType: 'audio/mp4; codecs="mp4a.40.2"' }] // Common audio codec
            }]);
            if (supported) {
                // If support object is returned, it means the browser reports supporting it conceptually.
                supportedKeySystems.push(keySystem);
            }
        } catch (e) {
            // Catching errors here means the key system or configuration was explicitly rejected/unsupported
            // by the browser's Media Key System Access API. This is not an error for the fingerprint,
            // but rather information about the environment's capabilities.
            // console.warn(`DRM check for ${keySystem} failed (expected for non-supported configs): ${e.message}`);
        }
    }

    if (supportedKeySystems.length > 0) {
        supportedKeySystems.sort(); // Ensure consistent order for fingerprinting
        return `DRM_Supported:[${supportedKeySystems.join(',')}]`;
    } else {
        return 'DRM_Supported:None'; // No listed DRM systems reported as supported
    }
}


/**
 * Computes the SHA-256 hash of a given string.
 * Robustly checks for crypto.subtle availability.
 * @param {string} str - The input string to hash.
 * @returns {Promise<string>} A promise that resolves with the SHA-256 hash in hexadecimal format or a fallback string if the Web Cryptography API is unavailable.
 */
async function sha256(str) {
    if (!window.crypto || !window.crypto.subtle) {
        console.warn("Web Cryptography API (crypto.subtle) not available. Returning a placeholder hash.");
        // Return a consistent placeholder if crypto.subtle is not available.
        // This ensures the script doesn't crash, but the fingerprint will be generic.
        return "web-crypto-api-not-available-fallback-hash";
    }
    try {
        const buffer = new TextEncoder().encode(str);
        const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    } catch (e) {
        console.error("Error during SHA-256 hashing:", e);
        // Return a different specific error string if hashing fails, even if crypto.subtle is present.
        return "hash-operation-failed-error";
    }
}

/**
 * Collects various browser and device attributes for fingerprinting.
 * @returns {Promise<{fingerprint: string, attributesDisplay: string, collectedStrings: string[], rawCanvasFingerprint: string, hashedCanvasFingerprint: string, rawAudioFingerprint: string, hashedAudioFingerprint: string, rawDrmFingerprint: string, hashedDrmFingerprint: string}>}
 * A promise that resolves with the generated fingerprint, HTML display string, raw collected strings,
 * the raw canvas fingerprint data URL, its hash, the raw audio fingerprint string, its hash,
 * the raw DRM fingerprint string, and its hash.
 */
export async function collectAttributesAndGenerateFingerprint() { // Removed includeDrm parameter
    const collectedStrings = [];
    let attributesDisplay = '';
    const ua = navigator.userAgent || 'N/A';
    const { browserName, browserVersion, os } = parseUserAgent(ua);

    // User Agent and OS
    collectedStrings.push(`ua_browser:${browserName} ${browserVersion}`);
    collectedStrings.push(`ua_os:${os}`);
    attributesDisplay += `<p><strong>Browser:</strong> ${browserName} ${browserVersion}</p><p><strong>OS:</strong> ${os}</p>`;

    // Screen Resolution
    try {
        const screenResolution = `${window.screen.width || 0}x${window.screen.height || 0}`;
        collectedStrings.push(`screen:${screenResolution}`);
        attributesDisplay += `<p><strong>Screen:</strong> ${screenResolution}</p>`;
    } catch (e) {
        collectedStrings.push('screen:N/A');
        attributesDisplay += `<p><strong>Screen:</strong> N/A</p>`;
    }

    // Timezone
    try {
        const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'N/A';
        collectedStrings.push(`timezone:${timezone}`);
        attributesDisplay += `<p><strong>Timezone:</strong> ${timezone}</p>`;
    } catch (e) {
        collectedStrings.push('timezone:N/A');
        attributesDisplay += `<p><strong>Timezone:</strong> N/A</p>`;
    }

    // Language
    const language = navigator.language || (navigator.languages && navigator.languages[0]) || 'N/A';
    collectedStrings.push(`lang:${language}`);
    attributesDisplay += `<p><strong>Language:</strong> ${language}</p>`;

    // Hardware Concurrency (CPU Cores)
    const hardwareConcurrency = navigator.hardwareConcurrency || 'N/A';
    collectedStrings.push(`cores:${hardwareConcurrency}`);
    attributesDisplay += `<p><strong>Cores:</strong> ${hardwareConcurrency}</p>`;

    // Device Memory (approx GB)
    if (navigator.deviceMemory) {
        collectedStrings.push(`memory:${navigator.deviceMemory}`);
        attributesDisplay += `<p><strong>Memory (GB approx):</strong> ${navigator.deviceMemory}</p>`;
    } else {
        collectedStrings.push('memory:N/A');
        attributesDisplay += `<p><strong>Memory (GB approx):</strong> N/A</p>`;
    }

    // Canvas Fingerprint
    const rawCanvasFingerprint = await getCanvasFingerprint();
    const hashedCanvasFingerprint = await sha256(rawCanvasFingerprint); // HASH THE RAW CANVAS FP
    collectedStrings.push(`canvas_fp_val:${rawCanvasFingerprint}`); // Keep raw for overall hash
    attributesDisplay += `<p><strong>Canvas Data URL (full):</strong> <span style="font-size: 0.75em; word-break: break-all;">${rawCanvasFingerprint}</span></p>`;
    attributesDisplay += `<p><strong>Canvas Data URL (SHA-256):</strong> <span style="font-size: 0.75em; word-break: break-all;">${hashedCanvasFingerprint}</span></p>`;


    // Audio Fingerprint
    const rawAudioFingerprint = await getAudioFingerprint();
    const hashedAudioFingerprint = await sha256(rawAudioFingerprint); // HASH THE RAW AUDIO FP
    collectedStrings.push(`audio_fp_val:${rawAudioFingerprint}`); // Keep raw for overall hash
    attributesDisplay += `<p><strong>Audio Parameters (full):</strong> <span style="font-size: 0.75em; word-break: break-all;">${rawAudioFingerprint}</span></p>`;
    attributesDisplay += `<p><strong>Audio Parameters (SHA-256):</strong> <span style="font-size: 0.75em; word-break: break-all;">${hashedAudioFingerprint}</span></p>`;

    // DRM Fingerprint (Always Included)
    const rawDrmFingerprint = await getDrmFingerprint();
    const hashedDrmFingerprint = await sha256(rawDrmFingerprint);
    collectedStrings.push(`drm_fp_val:${rawDrmFingerprint}`);
    attributesDisplay += `<p><strong>DRM Support (full):</strong> <span style="font-size: 0.75em; word-break: break-all;">${rawDrmFingerprint}</span></p>`;
    attributesDisplay += `<p><strong>DRM Support (SHA-256):</strong> <span style="font-size: 0.75em; word-break: break-all;">${hashedDrmFingerprint}</span></p>`;

    // Combine all attributes into a single string, sorted for consistency
    collectedStrings.sort(); // Sort to ensure order doesn't affect the hash
    const attributeString = collectedStrings.join('||'); // Use a unique separator

    const fingerprint = await sha256(attributeString);

    return {
        fingerprint,
        attributesDisplay,
        collectedStrings,
        rawCanvasFingerprint,
        hashedCanvasFingerprint,
        rawAudioFingerprint,
        hashedAudioFingerprint,
        rawDrmFingerprint,
        hashedDrmFingerprint
    };
}

