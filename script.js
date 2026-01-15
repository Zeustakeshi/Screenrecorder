// ===== DOM Elements =====
const preview = document.getElementById('preview');
const placeholder = document.getElementById('placeholder');
const recordingIndicator = document.getElementById('recordingIndicator');
const timerDisplay = document.getElementById('timer');
const startBtn = document.getElementById('startBtn');
const stopBtn = document.getElementById('stopBtn');
const downloadSection = document.getElementById('downloadSection');
const downloadWebm = document.getElementById('downloadWebm');
const downloadMp4 = document.getElementById('downloadMp4');
const videoInfo = document.getElementById('videoInfo');

// Modal Elements
const audioModal = document.getElementById('audioModal');
const systemAudioCheckbox = document.getElementById('systemAudio');
const micAudioCheckbox = document.getElementById('micAudio');
const cancelModalBtn = document.getElementById('cancelModal');
const confirmRecordBtn = document.getElementById('confirmRecord');

// ===== State =====
let mediaRecorder = null;
let recordedChunks = [];
let screenStream = null;
let micStream = null;
let combinedStream = null;
let timerInterval = null;
let startTime = null;

// ===== Constants =====
const MAX_RECORDING_DURATION = 4 * 60 * 60; // 4 hours in seconds
const CHUNK_INTERVAL = 1000; // Collect data every 1 second for better memory management

// ===== Timer Functions =====
function formatTime(seconds) {
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60).toString().padStart(2, '0');
    const secs = (seconds % 60).toString().padStart(2, '0');
    
    if (hours > 0) {
        return `${hours.toString().padStart(2, '0')}:${mins}:${secs}`;
    }
    return `${mins}:${secs}`;
}

function startTimer() {
    startTime = Date.now();
    timerDisplay.textContent = '00:00';
    
    timerInterval = setInterval(() => {
        const elapsed = Math.floor((Date.now() - startTime) / 1000);
        timerDisplay.textContent = formatTime(elapsed);
        
        // Auto-stop at max duration (4 hours)
        if (elapsed >= MAX_RECORDING_DURATION) {
            console.log('Max recording duration reached (4 hours)');
            stopRecording();
        }
    }, 1000);
}

function stopTimer() {
    if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = null;
    }
}

// ===== Modal Functions =====
function showModal() {
    audioModal.classList.remove('hidden');
    document.body.style.overflow = 'hidden';
}

function hideModal() {
    audioModal.classList.add('hidden');
    document.body.style.overflow = '';
}

// ===== Recording Functions =====
async function startRecording() {
    const useSystemAudio = systemAudioCheckbox.checked;
    const useMicAudio = micAudioCheckbox.checked;
    
    try {
        // Hide modal first
        hideModal();
        
        // Request screen share with system audio option
        screenStream = await navigator.mediaDevices.getDisplayMedia({
            video: {
                cursor: 'always',
                displaySurface: 'monitor'
            },
            audio: useSystemAudio
        });

        // Get microphone stream if requested
        if (useMicAudio) {
            try {
                micStream = await navigator.mediaDevices.getUserMedia({
                    audio: {
                        echoCancellation: true,
                        noiseSuppression: true,
                        autoGainControl: true
                    }
                });
            } catch (micError) {
                console.warn('Could not access microphone:', micError);
                // Continue without microphone
            }
        }

        // Combine streams
        combinedStream = combineStreams(screenStream, micStream, useSystemAudio);

        // Show preview (video only from screen)
        preview.srcObject = screenStream;
        placeholder.classList.add('hidden');
        
        // Reset recorded chunks
        recordedChunks = [];
        
        // Create MediaRecorder with combined stream
        const mimeType = getSupportedMimeType();
        mediaRecorder = new MediaRecorder(combinedStream, { mimeType });
        
        mediaRecorder.ondataavailable = (event) => {
            if (event.data.size > 0) {
                recordedChunks.push(event.data);
            }
        };
        
        mediaRecorder.onstop = handleRecordingStop;
        
        // Handle when user stops sharing via browser UI
        screenStream.getVideoTracks()[0].onended = () => {
            if (mediaRecorder && mediaRecorder.state !== 'inactive') {
                stopRecording();
            }
        };
        
        // Start recording with optimized chunk interval for long recordings
        mediaRecorder.start(CHUNK_INTERVAL);
        
        // Update UI
        startBtn.classList.add('hidden');
        stopBtn.classList.remove('hidden');
        recordingIndicator.classList.remove('hidden');
        downloadSection.classList.add('hidden');
        
        // Start timer
        startTimer();
        
    } catch (error) {
        console.error('Error starting recording:', error);
        hideModal();
        
        // Cleanup any partial streams
        cleanupStreams();
        
        // User cancelled or error occurred
        if (error.name !== 'NotAllowedError') {
            alert('Không thể bắt đầu quay màn hình. Vui lòng thử lại.');
        }
    }
}

function combineStreams(screenStream, micStream, useSystemAudio) {
    const tracks = [];
    
    // Add video track from screen
    const videoTrack = screenStream.getVideoTracks()[0];
    if (videoTrack) {
        tracks.push(videoTrack);
    }
    
    // Check if we need to mix audio
    const screenAudioTracks = screenStream.getAudioTracks();
    const hasScreenAudio = useSystemAudio && screenAudioTracks.length > 0;
    const hasMicAudio = micStream && micStream.getAudioTracks().length > 0;
    
    if (hasScreenAudio && hasMicAudio) {
        // Mix both audio sources using AudioContext
        const audioContext = new AudioContext();
        const destination = audioContext.createMediaStreamDestination();
        
        // Add screen audio
        const screenAudioSource = audioContext.createMediaStreamSource(
            new MediaStream([screenAudioTracks[0]])
        );
        screenAudioSource.connect(destination);
        
        // Add microphone audio
        const micAudioSource = audioContext.createMediaStreamSource(micStream);
        micAudioSource.connect(destination);
        
        // Add mixed audio track
        const mixedAudioTrack = destination.stream.getAudioTracks()[0];
        if (mixedAudioTrack) {
            tracks.push(mixedAudioTrack);
        }
    } else if (hasScreenAudio) {
        // Only system audio
        tracks.push(screenAudioTracks[0]);
    } else if (hasMicAudio) {
        // Only microphone audio
        tracks.push(micStream.getAudioTracks()[0]);
    }
    
    return new MediaStream(tracks);
}

function cleanupStreams() {
    if (screenStream) {
        screenStream.getTracks().forEach(track => track.stop());
        screenStream = null;
    }
    if (micStream) {
        micStream.getTracks().forEach(track => track.stop());
        micStream = null;
    }
    combinedStream = null;
}

function stopRecording() {
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
        mediaRecorder.stop();
    }
    
    // Cleanup all streams
    cleanupStreams();
    
    // Stop timer
    stopTimer();
    
    // Update UI
    startBtn.classList.remove('hidden');
    stopBtn.classList.add('hidden');
    recordingIndicator.classList.add('hidden');
}

function handleRecordingStop() {
    // Create blob from recorded chunks
    const mimeType = getSupportedMimeType();
    const blob = new Blob(recordedChunks, { type: mimeType });
    
    // Create download URL
    const url = URL.createObjectURL(blob);
    
    // Generate filename with timestamp
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    
    // Set up WebM download (original format)
    downloadWebm.href = url;
    downloadWebm.download = `screen-recording-${timestamp}.webm`;
    
    // Set up MP4 download (same blob, browser will handle)
    downloadMp4.href = url;
    downloadMp4.download = `screen-recording-${timestamp}.mp4`;
    
    // Show video info
    const sizeMB = (blob.size / (1024 * 1024)).toFixed(2);
    const duration = timerDisplay.textContent;
    videoInfo.textContent = `${duration} • ${sizeMB} MB`;
    
    // Show download section
    downloadSection.classList.remove('hidden');
    
    // Show video in preview
    preview.srcObject = null;
    preview.src = url;
    preview.muted = true; // Keep muted to prevent audio feedback loop
    preview.controls = true;
}

// ===== Utility Functions =====
function getSupportedMimeType() {
    const types = [
        'video/webm;codecs=vp9,opus',
        'video/webm;codecs=vp8,opus',
        'video/webm;codecs=vp9',
        'video/webm;codecs=vp8',
        'video/webm',
        'video/mp4'
    ];
    
    for (const type of types) {
        if (MediaRecorder.isTypeSupported(type)) {
            return type;
        }
    }
    
    return 'video/webm';
}

// ===== Event Listeners =====

// Start button opens modal
startBtn.addEventListener('click', showModal);

// Modal buttons
cancelModalBtn.addEventListener('click', hideModal);
confirmRecordBtn.addEventListener('click', startRecording);

// Close modal on backdrop click
audioModal.addEventListener('click', (event) => {
    if (event.target === audioModal.querySelector('.modal-backdrop')) {
        hideModal();
    }
});

// Stop button
stopBtn.addEventListener('click', stopRecording);

// Keyboard shortcuts
document.addEventListener('keydown', (event) => {
    // Close modal with Escape
    if (event.key === 'Escape') {
        if (!audioModal.classList.contains('hidden')) {
            hideModal();
            return;
        }
        // Stop recording with Escape
        if (mediaRecorder && mediaRecorder.state === 'recording') {
            stopRecording();
        }
    }
    
    // Press 'R' to start/stop recording
    if (event.key.toLowerCase() === 'r' && !event.ctrlKey && !event.metaKey) {
        // Don't trigger if modal is open
        if (!audioModal.classList.contains('hidden')) return;
        
        if (mediaRecorder && mediaRecorder.state === 'recording') {
            stopRecording();
        } else if (!mediaRecorder || mediaRecorder.state === 'inactive') {
            showModal();
        }
    }
});

// Cleanup on page unload
window.addEventListener('beforeunload', () => {
    cleanupStreams();
    stopTimer();
});

// ===== Check Browser Support =====
function checkSupport() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getDisplayMedia) {
        startBtn.disabled = true;
        startBtn.innerHTML = '<span>Trình duyệt không hỗ trợ</span>';
        placeholder.querySelector('p').textContent = 
            'Trình duyệt của bạn không hỗ trợ quay màn hình. Vui lòng sử dụng Chrome, Edge hoặc Firefox.';
    }
}

// Initialize
checkSupport();
