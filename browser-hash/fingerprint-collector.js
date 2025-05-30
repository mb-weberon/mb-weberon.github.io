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
 * @returns {Promise<{fingerprint: string, attributesDisplay: string, collectedStrings: string[]}>}
 * A promise that resolves with the generated fingerprint, HTML display string, and raw collected strings.
 */
export async function collectAttributesAndGenerateFingerprint() {
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
    const canvasFingerprint = await getCanvasFingerprint();
    collectedStrings.push(`canvas_fp_val:${canvasFingerprint}`);
    attributesDisplay += `<p><strong>Canvas Data URL (full):</strong> <span style="font-size: 0.75em; word-break: break-all;">${canvasFingerprint}</span></p>`;

    // Combine all attributes into a single string, sorted for consistency
    collectedStrings.sort(); // Sort to ensure order doesn't affect the hash
    const attributeString = collectedStrings.join('||'); // Use a unique separator

    const fingerprint = await sha256(attributeString);

    return { fingerprint, attributesDisplay, collectedStrings };
}
