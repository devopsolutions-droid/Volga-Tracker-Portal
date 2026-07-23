// Volga Infosys - Real-Time LinkedIn-Style Chat Module
// Self-contained script to inject chat interface and handle live messaging

(function() {
    // 1. Session & Auth Check
    const userRole = sessionStorage.getItem('role');
    const isLoggedIn = sessionStorage.getItem('loggedIn') === 'true';
    if (!isLoggedIn) return; // Do not load chat if user is not logged in

    let currentUserId = sessionStorage.getItem('userid') || (userRole === 'admin' ? 'adminvolga' : '');
    const currentUserDisplayName = sessionStorage.getItem('username') || (userRole === 'admin' ? 'Admin' : 'Unknown');

    if (!currentUserId) {
        console.warn("Chat module loaded but current user ID could not be identified.");
        return;
    }

    // Resolve scope-level globals (since ES6 block-scoped let/const do not attach to window)
    const activeDb = (typeof db !== 'undefined' && db !== null) ? db : null;
    const activeDbHelper = (typeof dbHelper !== 'undefined' && dbHelper !== null) ? dbHelper : null;

    // 2. Global State
    let activeChatUserId = null;
    let activeChatUserDisplayName = '';
    let activeChatUserRole = '';
    let activeChatIsGroup = false;
    let activeRosterTab = 'general'; // 'general' or 'groups'
    let uploadedGroupIconBase64 = ''; // Store custom group icon base64
    let usersList = [];
    let chatMetadata = {}; // Maps chatId -> { lastMessage, lastSenderId, lastUpdated, unreadCount: { userId: count } }
    let firestoreChatListener = null;
    let firestoreMetadataListener = null;
    let isPanelOpen = false;

    // 3. Inject CSS Styles
    const cssStyles = `
        /* Floating Chat Button */
        .volga-chat-trigger {
            position: fixed;
            bottom: 24px;
            right: 24px;
            width: 56px;
            height: 56px;
            border-radius: 50%;
            background: linear-gradient(135deg, var(--primary, #3b82f6) 0%, #1d4ed8 100%);
            color: white;
            border: none;
            box-shadow: 0 4px 14px rgba(59, 130, 246, 0.4), 0 0 0 1px rgba(255, 255, 255, 0.1) inset;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 99999;
            transition: transform 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275), box-shadow 0.2s;
        }
        .volga-chat-trigger:hover {
            transform: scale(1.08);
            box-shadow: 0 6px 20px rgba(59, 130, 246, 0.5), 0 0 0 1px rgba(255, 255, 255, 0.2) inset;
        }
        .volga-chat-trigger:active {
            transform: scale(0.95);
        }
        .volga-chat-trigger-badge {
            position: absolute;
            top: -2px;
            right: -2px;
            background: #ef4444;
            color: white;
            border-radius: 50%;
            min-width: 20px;
            height: 20px;
            padding: 0 4px;
            font-size: 0.72rem;
            font-weight: 800;
            display: flex;
            align-items: center;
            justify-content: center;
            border: 2px solid #ffffff;
            box-shadow: 0 2px 6px rgba(239, 68, 68, 0.3);
            animation: pulseUnread 2s infinite;
        }
        @keyframes pulseUnread {
            0% { transform: scale(1); }
            50% { transform: scale(1.1); }
            100% { transform: scale(1); }
        }

        /* Chat Panel Container */
        .volga-chat-panel {
            position: fixed;
            bottom: 92px;
            right: 24px;
            width: 360px;
            height: 520px;
            background: rgba(255, 255, 255, 0.9);
            backdrop-filter: blur(20px);
            -webkit-backdrop-filter: blur(20px);
            border-radius: 16px;
            border: 1px solid rgba(226, 232, 240, 0.8);
            box-shadow: 0 12px 40px rgba(15, 23, 42, 0.12), 0 0 0 1px rgba(255, 255, 255, 0.6) inset;
            z-index: 99998;
            display: flex;
            flex-direction: column;
            overflow: hidden;
            transform: translateY(20px) scale(0.95);
            opacity: 0;
            pointer-events: none;
            transition: transform 0.25s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.25s;
        }
        .volga-chat-panel.open {
            transform: translateY(0) scale(1);
            opacity: 1;
            pointer-events: auto;
        }

        /* Panel Header */
        .volga-chat-header {
            padding: 14px 18px;
            background: rgba(255, 255, 255, 0.6);
            border-bottom: 1px solid rgba(226, 232, 240, 0.8);
            display: flex;
            align-items: center;
            justify-content: space-between;
        }
        .volga-chat-title-group {
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .volga-chat-title {
            font-weight: 800;
            font-size: 0.95rem;
            color: var(--dark, #1e293b);
            margin: 0;
            line-height: 1.2;
        }
        
        .volga-chat-close-btn {
            background: none;
            border: none;
            color: var(--text-muted, #64748b);
            cursor: pointer;
            padding: 4px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: background 0.2s, color 0.2s;
        }
        .volga-chat-close-btn:hover {
            background: rgba(241, 245, 249, 0.8);
            color: var(--dark, #1e293b);
        }

        /* Screen Body Wrapper */
        .volga-chat-body {
            flex: 1;
            display: flex;
            flex-direction: column;
            overflow: hidden;
            position: relative;
        }

        /* Screen - Inbox */
        .volga-chat-inbox-screen {
            display: flex;
            flex-direction: column;
            height: 100%;
        }
        .volga-chat-search-bar {
            padding: 10px 14px;
            border-bottom: 1px solid rgba(226, 232, 240, 0.5);
            background: rgba(248, 250, 252, 0.5);
        }
        .volga-chat-search-input {
            width: 100%;
            padding: 8px 12px;
            border: 1px solid rgba(226, 232, 240, 0.8);
            border-radius: 8px;
            font-size: 0.82rem;
            background: white;
            outline: none;
            transition: border-color 0.2s, box-shadow 0.2s;
        }
        .volga-chat-search-input:focus {
            border-color: var(--primary, #3b82f6);
            box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.15);
        }
        .volga-chat-users-list {
            flex: 1;
            overflow-y: auto;
            padding: 8px 0;
        }
        .volga-chat-user-item {
            display: flex;
            align-items: center;
            gap: 12px;
            padding: 10px 16px;
            cursor: pointer;
            transition: background-color 0.2s;
            border-bottom: 1px solid rgba(241, 245, 249, 0.5);
        }
        .volga-chat-user-item:hover {
            background-color: rgba(241, 245, 249, 0.7);
        }
        .volga-chat-user-avatar {
            width: 40px;
            height: 40px;
            border-radius: 50%;
            background-color: #e2e8f0;
            display: flex;
            align-items: center;
            justify-content: center;
            font-weight: 700;
            color: white;
            flex-shrink: 0;
            overflow: hidden;
            position: relative;
        }
        .volga-chat-user-avatar-presence {
            position: absolute;
            bottom: 0;
            right: 0;
            width: 9px;
            height: 9px;
            background-color: #22c55e;
            border: 2px solid #ffffff;
            border-radius: 50%;
            z-index: 5;
            box-shadow: 0 0 4px rgba(34, 197, 94, 0.5);
        }
        .volga-chat-user-avatar img {
            width: 100%;
            height: 100%;
            object-fit: cover;
        }
        .volga-chat-user-info {
            flex: 1;
            min-width: 0;
            display: flex;
            flex-direction: column;
            gap: 2px;
        }
        .volga-chat-user-top {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 6px;
        }
        .volga-chat-user-name {
            font-weight: 700;
            font-size: 0.85rem;
            color: var(--dark, #1e293b);
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
        }
        .volga-chat-user-role-badge {
            font-size: 0.62rem;
            font-weight: 700;
            text-transform: uppercase;
            padding: 1px 4px;
            border-radius: 3px;
            flex-shrink: 0;
        }
        .volga-chat-role-admin { background: rgba(139, 92, 246, 0.1); color: #7c3aed; }
        .volga-chat-role-user { background: rgba(59, 130, 246, 0.1); color: #2563eb; }
        
        .volga-chat-user-time {
            font-size: 0.68rem;
            color: var(--text-muted, #64748b);
            flex-shrink: 0;
        }
        .volga-chat-user-snippet-row {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 8px;
        }
        .volga-chat-user-snippet {
            font-size: 0.76rem;
            color: var(--text-muted, #64748b);
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            flex: 1;
        }
        .volga-chat-user-snippet.unread {
            font-weight: 700;
            color: var(--dark, #1e293b);
        }
        .volga-chat-user-unread-badge {
            background: var(--primary, #3b82f6);
            color: white;
            font-size: 0.65rem;
            font-weight: 800;
            border-radius: 10px;
            min-width: 16px;
            height: 16px;
            padding: 0 4px;
            display: flex;
            align-items: center;
            justify-content: center;
            flex-shrink: 0;
        }

        /* Screen - Chat Window */
        .volga-chat-window-screen {
            display: flex;
            flex-direction: column;
            height: 100%;
            background: #f8fafc;
            transform: translateX(100%);
            transition: transform 0.25s cubic-bezier(0.16, 1, 0.3, 1);
            position: absolute;
            top: 0; left: 0; right: 0; bottom: 0;
            z-index: 2;
        }
        .volga-chat-window-screen.active {
            transform: translateX(0);
        }
        
        /* Chat Window Header */
        .volga-chat-window-header {
            padding: 10px 14px;
            background: white;
            border-bottom: 1px solid rgba(226, 232, 240, 0.8);
            display: flex;
            align-items: center;
            gap: 10px;
        }
        .volga-chat-back-btn {
            background: none;
            border: none;
            color: var(--text-muted, #64748b);
            cursor: pointer;
            padding: 6px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: background 0.2s;
        }
        .volga-chat-back-btn:hover {
            background: #f1f5f9;
            color: var(--dark, #1e293b);
        }
        .volga-chat-window-avatar {
            width: 34px;
            height: 34px;
            border-radius: 50%;
            background: #cbd5e1;
            font-weight: bold;
            color: white;
            display: flex;
            align-items: center;
            justify-content: center;
        }
        .volga-chat-window-title-group {
            flex: 1;
            min-width: 0;
            display: flex;
            flex-direction: column;
        }
        .volga-chat-window-title {
            font-weight: 700;
            font-size: 0.85rem;
            color: var(--dark, #1e293b);
            white-space: nowrap;
            overflow: hidden;
            text-overflow: ellipsis;
            margin: 0;
        }
        .volga-chat-window-subtitle {
            font-size: 0.65rem;
            color: var(--text-muted, #64748b);
            margin: 0;
        }

        /* Message Box Area */
        .volga-chat-messages-container {
            flex: 1;
            overflow-y: auto;
            padding: 16px;
            display: flex;
            flex-direction: column;
        }
        .volga-chat-msg-bubble-row {
            display: flex;
            flex-direction: column;
            max-width: 80%;
            margin-bottom: 12px;
        }
        .volga-chat-msg-bubble-row.me {
            align-self: flex-end;
            align-items: flex-end;
        }
        .volga-chat-msg-bubble-row.others {
            align-self: flex-start;
            align-items: flex-start;
        }
        .volga-chat-msg-bubble {
            padding: 8px 12px;
            font-size: 0.8rem;
            line-height: 1.4;
            border-radius: 12px;
            word-break: break-word;
        }
        .volga-chat-msg-bubble-row.me .volga-chat-msg-bubble {
            background: var(--primary, #3b82f6);
            color: white;
            border-bottom-right-radius: 2px;
        }
        .volga-chat-msg-bubble-row.others .volga-chat-msg-bubble {
            background: white;
            color: var(--text-main, #334155);
            border: 1px solid rgba(226, 232, 240, 0.8);
            border-bottom-left-radius: 2px;
        }
        .volga-chat-msg-time {
            font-size: 0.64rem;
            color: var(--text-muted, #64748b);
            margin-top: 4px;
            padding: 0 4px;
        }
        .volga-chat-msg-empty {
            text-align: center;
            color: var(--text-muted, #64748b);
            font-size: 0.78rem;
            margin: auto;
            font-weight: 500;
        }

        /* Message Input Area */
        .volga-chat-input-bar {
            padding: 10px 14px;
            background: white;
            border-top: 1px solid rgba(226, 232, 240, 0.8);
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .volga-chat-input {
            flex: 1;
            padding: 8px 12px;
            border: 1px solid rgba(226, 232, 240, 0.8);
            border-radius: 20px;
            font-size: 0.82rem;
            outline: none;
            resize: none;
            background: #f8fafc;
            max-height: 80px;
            font-family: inherit;
        }
        .volga-chat-input:focus {
            border-color: var(--primary, #3b82f6);
            background: white;
        }
        .volga-chat-send-btn {
            background: var(--primary, #3b82f6);
            color: white;
            border: none;
            width: 32px;
            height: 32px;
            border-radius: 50%;
            display: flex;
            align-items: center;
            justify-content: center;
            cursor: pointer;
            transition: background 0.2s, transform 0.1s;
            flex-shrink: 0;
        }
        .volga-chat-send-btn:hover {
            background: var(--primary-hover, #2563eb);
            transform: scale(1.05);
        }
        .volga-chat-send-btn:active {
            transform: scale(0.95);
        }
        
        /* Hide scrollbars partially for clean design */
        .volga-chat-users-list::-webkit-scrollbar,
        .volga-chat-messages-container::-webkit-scrollbar {
            width: 5px;
        }
        .volga-chat-users-list::-webkit-scrollbar-thumb,
        .volga-chat-messages-container::-webkit-scrollbar-thumb {
            background: rgba(0, 0, 0, 0.1);
            border-radius: 4px;
        }

        /* Create Group Button */
        .volga-chat-create-group-btn {
            width: 32px;
            height: 32px;
            border-radius: 8px;
            background: var(--primary, #3b82f6);
            color: white;
            border: none;
            cursor: pointer;
            font-size: 1.2rem;
            font-weight: 700;
            display: flex;
            align-items: center;
            justify-content: center;
            flex-shrink: 0;
            transition: background 0.2s, transform 0.1s;
        }
        .volga-chat-create-group-btn:hover {
            background: var(--primary-hover, #2563eb);
            transform: scale(1.05);
        }

        /* Group Modal Backdrop */
        .volga-chat-group-modal {
            position: absolute;
            top: 0; left: 0; right: 0; bottom: 0;
            background: rgba(15, 23, 42, 0.4);
            backdrop-filter: blur(4px);
            z-index: 99999;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 16px;
        }
        .volga-chat-group-modal-content {
            background: white;
            border-radius: 14px;
            width: 100%;
            max-width: 320px;
            padding: 18px;
            box-shadow: 0 10px 30px rgba(0, 0, 0, 0.15);
            display: flex;
            flex-direction: column;
            gap: 12px;
            animation: modalFadeIn 0.2s ease-out;
        }
        @keyframes modalFadeIn {
            from { opacity: 0; transform: scale(0.95); }
            to { opacity: 1; transform: scale(1); }
        }
        .volga-chat-group-modal-title {
            font-weight: 850;
            font-size: 0.95rem;
            color: var(--dark, #1e293b);
            margin: 0;
        }
        .volga-chat-group-name-input {
            width: 100%;
            padding: 8px 12px;
            border: 1.5px solid rgba(226, 232, 240, 0.8);
            border-radius: 8px;
            font-size: 0.82rem;
            outline: none;
        }
        .volga-chat-group-name-input:focus {
            border-color: var(--primary, #3b82f6);
        }
        .volga-chat-group-participants-label {
            font-size: 0.72rem;
            font-weight: 700;
            color: var(--text-muted, #64748b);
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        .volga-chat-group-participants-list {
            max-height: 150px;
            overflow-y: auto;
            display: flex;
            flex-direction: column;
            gap: 8px;
            border: 1px solid rgba(226, 232, 240, 0.5);
            border-radius: 8px;
            padding: 8px 10px;
        }
        .volga-chat-group-participant-item {
            display: flex;
            align-items: center;
            gap: 8px;
            font-size: 0.8rem;
            color: var(--text-main, #334155);
            cursor: pointer;
            user-select: none;
        }
        .volga-chat-group-participant-item input {
            cursor: pointer;
            accent-color: var(--primary, #3b82f6);
        }
        .volga-chat-group-modal-actions {
            display: flex;
            gap: 8px;
            margin-top: 6px;
        }
        .volga-chat-group-modal-btn {
            flex: 1;
            padding: 8px;
            border-radius: 8px;
            border: none;
            font-size: 0.82rem;
            font-weight: 700;
            cursor: pointer;
            transition: background 0.2s;
        }
        .volga-chat-group-modal-btn.cancel {
            background: #f1f5f9;
            color: var(--text-main, #334155);
        }
        .volga-chat-group-modal-btn.cancel:hover {
            background: #e2e8f0;
        }
        .volga-chat-group-modal-btn.confirm {
            background: var(--primary, #3b82f6);
            color: white;
        }
        .volga-chat-group-modal-btn.confirm:hover {
            background: var(--primary-hover, #2563eb);
        }
        .volga-chat-group-modal-btn.delete {
            background: #fef2f2;
            color: #dc2626;
            border: 1px solid #fee2e2;
            width: 100%;
        }
        .volga-chat-group-modal-btn.delete:hover {
            background: #fee2e2;
        }
        .volga-chat-group-settings-trigger:hover {
            color: var(--primary, #3b82f6) !important;
        }

        /* Custom Alert Modal */
        .volga-chat-alert-modal {
            position: fixed;
            top: 0; left: 0; right: 0; bottom: 0;
            background: rgba(15, 23, 42, 0.4);
            backdrop-filter: blur(4px);
            z-index: 100000;
            display: flex;
            align-items: center;
            justify-content: center;
            opacity: 0;
            transition: opacity 0.2s ease;
        }
        .volga-chat-alert-modal.active {
            opacity: 1;
        }
        .volga-chat-alert-box {
            background: white;
            padding: 20px;
            border-radius: 16px;
            width: 90%;
            max-width: 300px;
            box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1);
            transform: scale(0.9);
            transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
            text-align: center;
        }
        .volga-chat-alert-modal.active .volga-chat-alert-box {
            transform: scale(1);
        }
        .volga-chat-alert-text {
            font-size: 0.85rem;
            color: #334155;
            font-weight: 700;
            margin-bottom: 18px;
            line-height: 1.4;
        }
        .volga-chat-alert-buttons {
            display: flex;
            gap: 8px;
            justify-content: center;
        }
        .volga-chat-alert-btn {
            padding: 8px 16px;
            border-radius: 8px;
            border: none;
            font-size: 0.78rem;
            font-weight: 700;
            cursor: pointer;
            transition: background 0.2s;
            flex: 1;
        }
        .volga-chat-alert-btn.cancel {
            background: #f1f5f9;
            color: #64748b;
        }
        .volga-chat-alert-btn.cancel:hover {
            background: #e2e8f0;
        }
        .volga-chat-alert-btn.confirm {
            background: #ef4444;
            color: white;
        }
        .volga-chat-alert-btn.confirm:hover {
            background: #dc2626;
        }
    `;

    // 4. Inject DOM Elements
    const chatHtml = `
        <button id="volga-chat-trigger" class="volga-chat-trigger" title="Open Chat">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
            </svg>
            <div id="volga-chat-unread-badge" class="volga-chat-trigger-badge" style="display: none;">0</div>
        </button>

        <div id="volga-chat-panel" class="volga-chat-panel">
            <!-- Header -->
            <div class="volga-chat-header">
                <div class="volga-chat-title-group">
                    <h3 class="volga-chat-title">Volga Messenger</h3>
                </div>
                <button id="volga-chat-close" class="volga-chat-close-btn" title="Close Panel">
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                </button>
            </div>

            <!-- Body -->
            <div class="volga-chat-body">
                <!-- Screen 1: Inbox / Users list -->
                <div id="volga-chat-inbox-screen" class="volga-chat-inbox-screen">
                    <div class="volga-chat-search-bar" style="display:flex;gap:8px;align-items:center;">
                        <input type="text" id="volga-chat-search" class="volga-chat-search-input" placeholder="Search coworkers...">
                        <button id="volga-chat-create-group-trigger" class="volga-chat-create-group-btn" style="display:none;" title="Create Group">+</button>
                    </div>
                    <div class="volga-chat-tabs" style="display:flex;border-bottom:1px solid rgba(226,232,240,0.8);background:#f8fafc;padding:0 8px;">
                        <button id="volga-chat-tab-general" class="volga-chat-tab active" style="flex:1;padding:8px;background:none;border:none;border-bottom:2px solid var(--primary, #3b82f6);font-size:0.8rem;font-weight:700;color:var(--primary, #3b82f6);cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;">
                            General
                            <span id="volga-chat-tab-gen-unread" style="display:none;background:#ef4444;color:white;font-size:0.65rem;font-weight:800;padding:1px 5px;border-radius:10px;line-height:1;">0</span>
                        </button>
                        <button id="volga-chat-tab-groups" class="volga-chat-tab" style="flex:1;padding:8px;background:none;border:none;border-bottom:2px solid transparent;font-size:0.8rem;font-weight:600;color:var(--text-muted, #64748b);cursor:pointer;display:flex;align-items:center;justify-content:center;gap:6px;">
                            Groups
                            <span id="volga-chat-tab-grp-unread" style="display:none;background:#ef4444;color:white;font-size:0.65rem;font-weight:800;padding:1px 5px;border-radius:10px;line-height:1;">0</span>
                        </button>
                    </div>
                    <div id="volga-chat-users-list" class="volga-chat-users-list">
                        <!-- User items injected dynamically -->
                        <div style="text-align:center;padding:20px;color:#94a3b8;font-size:0.8rem;">Loading coworkers...</div>
                    </div>
                </div>

                <!-- Screen 2: Direct Chat window -->
                <div id="volga-chat-window-screen" class="volga-chat-window-screen">
                    <div class="volga-chat-window-header">
                        <button id="volga-chat-back" class="volga-chat-back-btn" title="Back to inbox">
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                                <line x1="19" y1="12" x2="5" y2="12"></line>
                                <polyline points="12 19 5 12 12 5"></polyline>
                            </svg>
                        </button>
                        <div id="volga-chat-window-avatar" class="volga-chat-window-avatar">U</div>
                        <div class="volga-chat-window-title-group" style="flex: 1;">
                            <h4 id="volga-chat-window-title" class="volga-chat-window-title">User Name</h4>
                            <p id="volga-chat-window-subtitle" class="volga-chat-window-subtitle">User Role</p>
                        </div>
                        <button id="volga-chat-group-settings-trigger" class="volga-chat-group-settings-trigger" style="display:none;background:none;border:none;color:#64748b;cursor:pointer;padding:6px;transition:color 0.2s;" title="Group Settings">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                                <circle cx="12" cy="12" r="3"></circle>
                                <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
                            </svg>
                        </button>
                    </div>
                    <div id="volga-chat-messages" class="volga-chat-messages-container">
                        <!-- Message bubbles injected dynamically -->
                    </div>
                     <div class="volga-chat-input-bar" style="display:flex;align-items:center;gap:6px;padding:8px 10px;background:#ffffff;border-top:1px solid #e2e8f0;">
                        <label for="volga-chat-attach-input" id="volga-chat-attach-btn" class="volga-chat-attach-btn" style="cursor:pointer;color:#64748b;padding:6px;display:flex;align-items:center;justify-content:center;transition:color 0.2s;" title="Attach file (Image/PDF)">
                            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path>
                            </svg>
                        </label>
                        <input type="file" id="volga-chat-attach-input" style="display:none;" accept="image/*,application/pdf">
                        <input type="text" id="volga-chat-input" class="volga-chat-input" placeholder="Type a message..." autocomplete="off" style="flex:1;">
                        <button id="volga-chat-send" class="volga-chat-send-btn" title="Send message">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                                <line x1="22" y1="2" x2="11" y2="13"></line>
                                <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
                            </svg>
                        </button>
                    </div>
                </div>

                <!-- Group Creation Modal -->
                <div id="volga-chat-group-modal" class="volga-chat-group-modal" style="display: none;">
                    <div class="volga-chat-group-modal-content">
                        <h4 class="volga-chat-group-modal-title">Create Group Chat</h4>
                        <input type="text" id="volga-chat-group-name" class="volga-chat-group-name-input" placeholder="Group Name...">
                        <div class="volga-chat-group-icon-upload-row" style="display:flex;align-items:center;gap:10px;">
                            <div id="volga-chat-group-icon-preview" style="width:36px;height:36px;border-radius:10px;background:#e0f2fe;color:#0369a1;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:1rem;flex-shrink:0;overflow:hidden;">G</div>
                            <label for="volga-chat-group-icon-input" style="font-size:0.75rem;padding:6px 12px;background:#f1f5f9;border:1px solid #cbd5e1;border-radius:6px;cursor:pointer;font-weight:700;color:#334155;user-select:none;">Upload Group Icon</label>
                            <input type="file" id="volga-chat-group-icon-input" accept="image/*" style="display:none;">
                        </div>
                        <div class="volga-chat-group-participants-label">Select Coworkers:</div>
                        <div id="volga-chat-group-participants-list" class="volga-chat-group-participants-list">
                            <!-- Checkboxes populated dynamically -->
                        </div>
                        <div class="volga-chat-group-modal-actions">
                            <button type="button" id="volga-chat-group-cancel" class="volga-chat-group-modal-btn cancel">Cancel</button>
                            <button type="button" id="volga-chat-group-confirm" class="volga-chat-group-modal-btn confirm">Create</button>
                        </div>
                    </div>
                </div>

                <!-- Group Edit Modal -->
                <div id="volga-chat-group-edit-modal" class="volga-chat-group-modal" style="display: none;">
                    <div class="volga-chat-group-modal-content">
                        <h4 class="volga-chat-group-modal-title">Edit Group Chat</h4>
                        <input type="text" id="volga-chat-group-edit-name" class="volga-chat-group-name-input" placeholder="Group Name...">
                        <div class="volga-chat-group-icon-upload-row" style="display:flex;align-items:center;gap:10px;">
                            <div id="volga-chat-group-edit-icon-preview" style="width:36px;height:36px;border-radius:10px;background:#e0f2fe;color:#0369a1;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:1rem;flex-shrink:0;overflow:hidden;">G</div>
                            <label for="volga-chat-group-edit-icon-input" style="font-size:0.75rem;padding:6px 12px;background:#f1f5f9;border:1px solid #cbd5e1;border-radius:6px;cursor:pointer;font-weight:700;color:#334155;user-select:none;">Upload New Icon</label>
                            <input type="file" id="volga-chat-group-edit-icon-input" accept="image/*" style="display:none;">
                        </div>
                        <div class="volga-chat-group-participants-label">Manage Coworkers:</div>
                        <div id="volga-chat-group-edit-participants-list" class="volga-chat-group-participants-list">
                            <!-- Checkboxes populated dynamically -->
                        </div>
                        <div class="volga-chat-group-modal-actions" style="flex-direction:column;gap:8px;">
                            <div style="display:flex;gap:8px;width:100%;">
                                <button type="button" id="volga-chat-group-edit-cancel" class="volga-chat-group-modal-btn cancel" style="flex:1;">Cancel</button>
                                <button type="button" id="volga-chat-group-edit-confirm" class="volga-chat-group-modal-btn confirm" style="flex:1;">Save</button>
                            </div>
                            <button type="button" id="volga-chat-group-edit-delete" class="volga-chat-group-modal-btn delete" style="background:#fef2f2;color:#dc2626;border:1px solid #fee2e2;width:100%;">Delete Group</button>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <!-- Custom Alert/Confirm Modal -->
        <div id="volga-chat-alert-modal" class="volga-chat-alert-modal" style="display:none;">
            <div class="volga-chat-alert-box">
                <div id="volga-chat-alert-text" class="volga-chat-alert-text"></div>
                <div class="volga-chat-alert-buttons">
                    <button type="button" id="volga-chat-alert-cancel" class="volga-chat-alert-btn cancel">Cancel</button>
                    <button type="button" id="volga-chat-alert-confirm" class="volga-chat-alert-btn confirm">Delete</button>
                </div>
            </div>
        </div>
    `;

    // Initialize UI on page load
    function injectChatUI() {
        // Inject CSS
        const styleSheet = document.createElement("style");
        styleSheet.innerText = cssStyles;
        document.head.appendChild(styleSheet);

        // Inject HTML Wrapper
        const wrapper = document.createElement("div");
        wrapper.id = "volga-chat-wrapper";
        wrapper.innerHTML = chatHtml;
        document.body.appendChild(wrapper);

        // Bind events
        document.getElementById('volga-chat-trigger').addEventListener('click', toggleChatPanel);
        document.getElementById('volga-chat-close').addEventListener('click', toggleChatPanel);
        document.getElementById('volga-chat-back').addEventListener('click', closeActiveChatWindow);
        document.getElementById('volga-chat-send').addEventListener('click', handleSendClick);
        document.getElementById('volga-chat-input').addEventListener('keydown', handleInputKeydown);
        document.getElementById('volga-chat-search').addEventListener('input', handleSearchInput);

        // Bind Tab buttons
        document.getElementById('volga-chat-tab-general').addEventListener('click', () => switchRosterTab('general'));
        document.getElementById('volga-chat-tab-groups').addEventListener('click', () => switchRosterTab('groups'));

        // Bind Group modal events
        const groupTrigger = document.getElementById('volga-chat-create-group-trigger');
        if (groupTrigger) {
            groupTrigger.addEventListener('click', openGroupModal);
        }
        const groupCancel = document.getElementById('volga-chat-group-cancel');
        if (groupCancel) {
            groupCancel.addEventListener('click', closeGroupModal);
        }
        const groupConfirm = document.getElementById('volga-chat-group-confirm');
        if (groupConfirm) {
            groupConfirm.addEventListener('click', createGroupChat);
        }
        const groupIconInput = document.getElementById('volga-chat-group-icon-input');
        if (groupIconInput) {
            groupIconInput.addEventListener('change', handleGroupIconSelect);
        }

        // Bind Group Edit/Settings events
        const settingsTrigger = document.getElementById('volga-chat-group-settings-trigger');
        if (settingsTrigger) {
            settingsTrigger.addEventListener('click', openEditGroupModal);
        }
        const editCancel = document.getElementById('volga-chat-group-edit-cancel');
        if (editCancel) {
            editCancel.addEventListener('click', closeEditGroupModal);
        }
        const editConfirm = document.getElementById('volga-chat-group-edit-confirm');
        if (editConfirm) {
            editConfirm.addEventListener('click', saveEditGroupChanges);
        }
        const editDelete = document.getElementById('volga-chat-group-edit-delete');
        if (editDelete) {
            editDelete.addEventListener('click', deleteGroupChat);
        }
        const editIconInput = document.getElementById('volga-chat-group-edit-icon-input');
        if (editIconInput) {
            editIconInput.addEventListener('change', handleGroupEditIconSelect);
        }

        const attachInput = document.getElementById('volga-chat-attach-input');
        if (attachInput) {
            attachInput.addEventListener('change', handleFileAttachment);
        }



        // Load users & sync messages
        loadUsersRoster().then(() => {
            // Show group creation trigger if current user is admin
            if (currentUserId === 'adminvolga') {
                const triggerBtn = document.getElementById('volga-chat-create-group-trigger');
                if (triggerBtn) triggerBtn.style.display = 'block';
            }
            renderInboxList(); // Render immediately!
            initLiveSync();
        });
    }

    // Toggle Chat Panel visibility
    function toggleChatPanel() {
        const panel = document.getElementById('volga-chat-panel');
        isPanelOpen = !isPanelOpen;
        if (isPanelOpen) {
            panel.classList.add('open');
            renderInboxList();
        } else {
            panel.classList.remove('open');
        }
    }

    // Helper: generate avatar URLs
    function getAvatarUrl(seed) {
        const safeSeed = encodeURIComponent((seed || 'user').trim());
        return `https://api.dicebear.com/9.x/identicon/svg?seed=${safeSeed}&backgroundColor=dbeafe,ede9fe,dcfce7,fef3c7,fce7f3&rowColor=0f172a`;
    }

    function showCustomConfirm(message, onConfirm) {
        const modal = document.getElementById('volga-chat-alert-modal');
        const text = document.getElementById('volga-chat-alert-text');
        const confirmBtn = document.getElementById('volga-chat-alert-confirm');
        const cancelBtn = document.getElementById('volga-chat-alert-cancel');
        if (!modal || !text || !confirmBtn || !cancelBtn) return;

        text.textContent = message;
        confirmBtn.style.display = 'block';
        confirmBtn.textContent = 'Delete';
        confirmBtn.className = 'volga-chat-alert-btn confirm';
        cancelBtn.style.display = 'block';

        modal.style.display = 'flex';
        modal.offsetHeight; // Force layout
        modal.classList.add('active');

        // Reclone to strip previous listeners
        const newConfirm = confirmBtn.cloneNode(true);
        confirmBtn.parentNode.replaceChild(newConfirm, confirmBtn);
        const newCancel = cancelBtn.cloneNode(true);
        cancelBtn.parentNode.replaceChild(newCancel, cancelBtn);

        newConfirm.addEventListener('click', () => {
            modal.classList.remove('active');
            setTimeout(() => { modal.style.display = 'none'; }, 200);
            onConfirm();
        });

        newCancel.addEventListener('click', () => {
            modal.classList.remove('active');
            setTimeout(() => { modal.style.display = 'none'; }, 200);
        });
    }

    function showCustomAlert(message) {
        const modal = document.getElementById('volga-chat-alert-modal');
        const text = document.getElementById('volga-chat-alert-text');
        const confirmBtn = document.getElementById('volga-chat-alert-confirm');
        const cancelBtn = document.getElementById('volga-chat-alert-cancel');
        if (!modal || !text || !confirmBtn || !cancelBtn) return;

        text.textContent = message;
        confirmBtn.style.display = 'block';
        confirmBtn.textContent = 'OK';
        confirmBtn.className = 'volga-chat-alert-btn';
        confirmBtn.style.background = 'var(--primary, #3b82f6)';
        confirmBtn.style.color = 'white';
        cancelBtn.style.display = 'none';

        modal.style.display = 'flex';
        modal.offsetHeight; // Force layout
        modal.classList.add('active');

        const newConfirm = confirmBtn.cloneNode(true);
        confirmBtn.parentNode.replaceChild(newConfirm, confirmBtn);

        newConfirm.addEventListener('click', () => {
            modal.classList.remove('active');
            setTimeout(() => { modal.style.display = 'none'; }, 200);
        });
    }

    // 5. User Roster loading
    async function loadUsersRoster() {
        try {
            let loadedUsers = [];
            if (activeDbHelper && typeof activeDbHelper.getUsers === 'function') {
                loadedUsers = await activeDbHelper.getUsers();
            } else {
                // Read from localStorage if activeDbHelper is not defined
                const storedUsers = localStorage.getItem('engineTrackerUsers');
                const raw = storedUsers ? JSON.parse(storedUsers) : [];
                loadedUsers = raw.map(u => typeof u === 'string' ? { id: u, displayName: u, role: 'user' } : { role: 'user', ...u });
            }

            // Force admin IDs to align on 'adminvolga' for both hardcoded and database admin configurations
            const nameLower = currentUserDisplayName.toLowerCase().trim();
            if (userRole === 'admin' || nameLower === 'admin' || nameLower === 'adminvolga') {
                currentUserId = 'adminvolga';
            }

            // Fallback for resolving currentUserId from loaded roster if session is old
            if (!currentUserId && currentUserDisplayName) {
                const me = loadedUsers.find(u => u.displayName === currentUserDisplayName)
                        || loadedUsers.find(u => u.displayName.toLowerCase().trim() === currentUserDisplayName.toLowerCase().trim());
                if (me) {
                    currentUserId = me.id;
                    sessionStorage.setItem('userid', me.id);
                } else {
                    // Final safe slug fallback to prevent blank IDs
                    currentUserId = currentUserDisplayName.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
                }
            }

            // Exclude current user from roster
            usersList = loadedUsers.filter(u => u.id !== currentUserId);

            // Add Admin to list if not already there, and current user is NOT admin
            if (currentUserId !== 'adminvolga' && !usersList.find(u => u.id === 'adminvolga')) {
                usersList.unshift({
                    id: 'adminvolga',
                    displayName: 'Admin',
                    role: 'admin'
                });
            }
        } catch (e) {
            console.error("Failed to load users for chat roster:", e);
        }
    }

    // Generate unique Chat ID (supports both DM and Group IDs)
    function getChatId(userId) {
        if (typeof userId === 'string' && userId.startsWith('group_')) {
            return userId;
        }
        return [currentUserId, userId].sort().join('_');
    }

    // 6. Real-time Synchronization Layer (Firestore & LocalStorage)
    function initLiveSync() {
        if (activeDb) {
            // Live Firestore Mode: Listen to all chats where current user is participant
            firestoreMetadataListener = activeDb.collection('chats')
                .where('participants', 'array-contains', currentUserId)
                .onSnapshot(snapshot => {
                    snapshot.forEach(doc => {
                        chatMetadata[doc.id] = doc.data();
                    });
                    renderInboxList();
                    updateGlobalUnreadBadge();
                }, error => {
                    console.error("Firestore chat metadata sync failed:", error);
                    renderInboxList(); // Render roster as fail-safe fallback
                });
        } else {
            // Local Storage fallback Mode
            loadLocalMetadata();
            window.addEventListener('storage', handleLocalStorageEvent);
            renderInboxList();
            updateGlobalUnreadBadge();
        }
    }

    // Local Storage synchronization helpers
    function loadLocalMetadata() {
        try {
            const data = localStorage.getItem('volga_chat_metadata');
            chatMetadata = data ? JSON.parse(data) : {};
        } catch(e) {
            console.error(e);
        }
    }

    function saveLocalMetadata() {
        try {
            localStorage.setItem('volga_chat_metadata', JSON.stringify(chatMetadata));
            updateGlobalUnreadBadge();
        } catch(e) {
            console.error(e);
        }
    }

    function handleLocalStorageEvent(e) {
        if (e.key === 'volga_chat_metadata') {
            loadLocalMetadata();
            renderInboxList();
            updateGlobalUnreadBadge();
        } else if (activeChatUserId && e.key === `volga_chat_messages_${getChatId(activeChatUserId)}`) {
            streamLocalMessages();
        }
    }

    // 7. Render Screen 1: Inbox / Users List
    function renderInboxList(filterText = '') {
        const container = document.getElementById('volga-chat-users-list');
        if (!container) return;

        const term = filterText.toLowerCase().trim();
        const inboxItems = [];

        // 1. Add Group Chats (if active tab is 'groups')
        if (activeRosterTab === 'groups') {
            Object.keys(chatMetadata).forEach(chatId => {
                const meta = chatMetadata[chatId];
                if (meta && meta.isGroup && meta.participants && meta.participants.includes(currentUserId)) {
                    if (meta.name.toLowerCase().includes(term)) {
                        inboxItems.push({
                            id: chatId,
                            name: meta.name,
                            isGroup: true,
                            groupIcon: meta.groupIcon || '',
                            lastUpdated: meta.lastUpdated ? new Date(meta.lastUpdated).getTime() : 0,
                            lastMessage: meta.lastMessage || '',
                            lastSenderId: meta.lastSenderId || '',
                            unreadCount: meta.unreadCount?.[currentUserId] || 0
                        });
                    }
                }
            });
        }

        // 2. Add Direct Message users from usersList (if active tab is 'general')
        if (activeRosterTab === 'general') {
            usersList.forEach(u => {
                if (u.displayName.toLowerCase().includes(term)) {
                    const chatId = getChatId(u.id);
                    const meta = chatMetadata[chatId] || {};
                    inboxItems.push({
                        id: u.id,
                        name: u.displayName,
                        role: u.role,
                        isGroup: false,
                        lastUpdated: meta.lastUpdated ? new Date(meta.lastUpdated).getTime() : 0,
                        lastMessage: meta.lastMessage || '',
                        lastSenderId: meta.lastSenderId || '',
                        unreadCount: meta.unreadCount?.[currentUserId] || 0
                    });
                }
            });
        }

        // Sort items by lastUpdated descending
        inboxItems.sort((a, b) => b.lastUpdated - a.lastUpdated);

        if (inboxItems.length === 0) {
            container.innerHTML = `<div style="text-align:center;padding:20px;color:#94a3b8;font-size:0.8rem;">No conversations found.</div>`;
            return;
        }

        let html = '';
        inboxItems.forEach(item => {
            const isSnippetUnread = item.unreadCount > 0;

            // Formatted Time
            let timeStr = '';
            if (item.lastUpdated > 0) {
                const date = new Date(item.lastUpdated);
                const now = new Date();
                if (date.toDateString() === now.toDateString()) {
                    timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                } else {
                    timeStr = date.toLocaleDateString([], { month: 'short', day: 'numeric' });
                }
            }

            // Snippet prefix
            let lastSender = '';
            if (item.lastMessage) {
                if (item.lastSenderId === currentUserId) {
                    lastSender = 'You: ';
                } else if (item.isGroup) {
                    if (item.lastSenderId === 'system') {
                        lastSender = '';
                    } else {
                        const senderUser = usersList.find(u => u.id === item.lastSenderId);
                        const senderName = senderUser ? senderUser.displayName : (item.lastSenderId === 'adminvolga' ? 'Admin' : item.lastSenderId);
                        lastSender = `${senderName}: `;
                    }
                }
            }

            // Avatar & Info
            const avatarChar = item.name.charAt(0).toUpperCase();
            const avatarHtml = item.isGroup
                ? (item.groupIcon 
                    ? `<div class="volga-chat-user-avatar group" style="border-radius:10px;height:36px;width:36px;overflow:hidden;"><img src="${item.groupIcon}" style="width:100%;height:100%;object-fit:cover;"></div>`
                    : `<div class="volga-chat-user-avatar group" style="background:#e0f2fe;color:#0369a1;display:flex;align-items:center;justify-content:center;font-weight:800;border-radius:10px;font-size:1rem;height:36px;width:36px;">${avatarChar}</div>`)
                : `<div class="volga-chat-user-avatar"><img src="${getAvatarUrl(item.name)}" alt="${item.name}"></div>`;

            const badgeHtml = item.isGroup
                ? `<span class="volga-chat-user-role-badge" style="background:rgba(59,130,246,0.1);color:#3b82f6;">GROUP</span>`
                : `<span class="volga-chat-user-role-badge ${item.role === 'admin' ? 'volga-chat-role-admin' : 'volga-chat-role-user'}">${item.role}</span>`;

            html += `
                <div class="volga-chat-user-item" data-id="${item.id}" data-name="${item.name}" data-isgroup="${item.isGroup}" data-role="${item.role || 'group'}">
                    ${avatarHtml}
                    <div class="volga-chat-user-info">
                        <div class="volga-chat-user-top">
                            <span class="volga-chat-user-name">${item.name}</span>
                            ${badgeHtml}
                            <span class="volga-chat-user-time">${timeStr}</span>
                        </div>
                        <div class="volga-chat-user-snippet-row">
                            <span class="volga-chat-user-snippet ${isSnippetUnread ? 'unread' : ''}">
                                ${item.lastMessage ? `${lastSender}${escapeHtml(item.lastMessage)}` : '<i>Start a conversation</i>'}
                            </span>
                            ${item.unreadCount > 0 ? `<span class="volga-chat-user-unread-badge">${item.unreadCount}</span>` : ''}
                        </div>
                    </div>
                </div>
            `;
        });

        container.innerHTML = html;

        // Add Click Listeners to items
        container.querySelectorAll('.volga-chat-user-item').forEach(item => {
            item.addEventListener('click', function() {
                const targetId = this.getAttribute('data-id');
                const targetName = this.getAttribute('data-name');
                const targetRole = this.getAttribute('data-role');
                const isGroup = this.getAttribute('data-isgroup') === 'true';
                openActiveChatWindow(targetId, targetName, targetRole, isGroup);
            });
        });
    }

    // Render global triggers unread badge
    function updateGlobalUnreadBadge() {
        let totalUnread = 0;
        Object.keys(chatMetadata).forEach(cId => {
            const unread = chatMetadata[cId]?.unreadCount?.[currentUserId] || 0;
            totalUnread += unread;
        });

        const badge = document.getElementById('volga-chat-unread-badge');
        if (badge) {
            if (totalUnread > 0) {
                badge.textContent = totalUnread > 99 ? '99+' : totalUnread;
                badge.style.display = 'flex';
            } else {
                badge.style.display = 'none';
            }
        }

        // Also update tab badges
        updateTabUnreadBadges();
    }

    function updateTabUnreadBadges() {
        let generalUnread = 0;
        let groupsUnread = 0;
        
        Object.keys(chatMetadata).forEach(cId => {
            const meta = chatMetadata[cId];
            if (meta) {
                const unread = meta.unreadCount?.[currentUserId] || 0;
                if (meta.isGroup) {
                    groupsUnread += unread;
                } else {
                    generalUnread += unread;
                }
            }
        });
        
        const genBadge = document.getElementById('volga-chat-tab-gen-unread');
        const grpBadge = document.getElementById('volga-chat-tab-grp-unread');
        
        if (genBadge) {
            genBadge.textContent = generalUnread > 99 ? '99+' : generalUnread;
            genBadge.style.display = generalUnread > 0 ? 'inline-flex' : 'none';
        }
        if (grpBadge) {
            grpBadge.textContent = groupsUnread > 99 ? '99+' : groupsUnread;
            grpBadge.style.display = groupsUnread > 0 ? 'inline-flex' : 'none';
        }
    }

    function switchRosterTab(tab) {
        activeRosterTab = tab;
        
        const btnGen = document.getElementById('volga-chat-tab-general');
        const btnGrp = document.getElementById('volga-chat-tab-groups');
        
        if (!btnGen || !btnGrp) return;
        
        if (tab === 'general') {
            btnGen.classList.add('active');
            btnGen.style.borderBottomColor = 'var(--primary, #3b82f6)';
            btnGen.style.color = 'var(--primary, #3b82f6)';
            btnGen.style.fontWeight = '700';
            
            btnGrp.classList.remove('active');
            btnGrp.style.borderBottomColor = 'transparent';
            btnGrp.style.color = 'var(--text-muted, #64748b)';
            btnGrp.style.fontWeight = '600';
        } else {
            btnGrp.classList.add('active');
            btnGrp.style.borderBottomColor = 'var(--primary, #3b82f6)';
            btnGrp.style.color = 'var(--primary, #3b82f6)';
            btnGrp.style.fontWeight = '700';
            
            btnGen.classList.remove('active');
            btnGen.style.borderBottomColor = 'transparent';
            btnGen.style.color = 'var(--text-muted, #64748b)';
            btnGen.style.fontWeight = '600';
        }
        
        renderInboxList();
    }

    // 8. Direct Chat Window Flow
    function openActiveChatWindow(targetId, targetName, targetRole, isGroupChat = false) {
        activeChatUserId = targetId;
        activeChatUserDisplayName = targetName;
        activeChatUserRole = targetRole;
        activeChatIsGroup = isGroupChat;

        const win = document.getElementById('volga-chat-window-screen');
        document.getElementById('volga-chat-window-title').textContent = targetName;
        
        const subtitle = document.getElementById('volga-chat-window-subtitle');
        if (isGroupChat) {
            const meta = chatMetadata[targetId] || {};
            const pCount = meta.participants?.length || 0;
            subtitle.textContent = `GROUP • ${pCount} PARTICIPANTS`;
        } else {
            subtitle.textContent = targetRole.toUpperCase();
        }
        
        const avatar = document.getElementById('volga-chat-window-avatar');
        if (isGroupChat) {
            const meta = chatMetadata[targetId] || {};
            if (meta.groupIcon) {
                avatar.innerHTML = `<img src="${meta.groupIcon}" alt="${targetName}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">`;
            } else {
                const avatarChar = targetName.charAt(0).toUpperCase();
                avatar.innerHTML = `<div style="width:100%;height:100%;background:#e0f2fe;color:#0369a1;display:flex;align-items:center;justify-content:center;font-weight:800;border-radius:50%;font-size:0.95rem;">${avatarChar}</div>`;
            }
        } else {
            avatar.innerHTML = `<img src="${getAvatarUrl(targetName)}" alt="${targetName}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">`;
        }

        // Show/hide group settings gear icon (only for groups, and only if user is admin)
        const settingsTrigger = document.getElementById('volga-chat-group-settings-trigger');
        if (settingsTrigger) {
            if (isGroupChat && currentUserId === 'adminvolga') {
                settingsTrigger.style.display = 'block';
            } else {
                settingsTrigger.style.display = 'none';
            }
        }

        win.classList.add('active');
        
        // Reset unread count for this open thread
        resetUnreadCount(targetId);

        // Subscribing to direct messages
        streamMessages(targetId);

        // Autofocus Input
        setTimeout(() => {
            const input = document.getElementById('volga-chat-input');
            if (input) input.focus();
        }, 150);
    }

    function closeActiveChatWindow() {
        // Unsubscribe from active message listener
        if (firestoreChatListener) {
            firestoreChatListener();
            firestoreChatListener = null;
        }

        activeChatUserId = null;
        activeChatUserDisplayName = '';
        activeChatUserRole = '';
        activeChatIsGroup = false;

        const settingsTrigger = document.getElementById('volga-chat-group-settings-trigger');
        if (settingsTrigger) settingsTrigger.style.display = 'none';

        const win = document.getElementById('volga-chat-window-screen');
        win.classList.remove('active');
        
        // Refresh inbox Roster
        renderInboxList();
    }

    // Group Creation Modal Dialog Helpers
    function openGroupModal() {
        const modal = document.getElementById('volga-chat-group-modal');
        const list = document.getElementById('volga-chat-group-participants-list');
        if (!modal || !list) return;

        // Reset name field, file inputs, and previews
        document.getElementById('volga-chat-group-name').value = '';
        const iconInput = document.getElementById('volga-chat-group-icon-input');
        if (iconInput) iconInput.value = '';
        
        const preview = document.getElementById('volga-chat-group-icon-preview');
        if (preview) preview.innerHTML = 'G';
        
        uploadedGroupIconBase64 = '';

        // Populate checklists
        let html = '';
        usersList.forEach(u => {
            html += `
                <label class="volga-chat-group-participant-item">
                    <input type="checkbox" class="volga-chat-group-participant-checkbox" value="${u.id}">
                    <span>${escapeHtml(u.displayName)}</span>
                </label>
            `;
        });
        list.innerHTML = html || '<div style="font-size:0.8rem;color:#94a3b8;padding:8px 0;text-align:center;">No coworkers available</div>';

        modal.style.display = 'flex';
    }

    function closeGroupModal() {
        const modal = document.getElementById('volga-chat-group-modal');
        if (modal) modal.style.display = 'none';
        uploadedGroupIconBase64 = '';
    }

    function handleGroupIconSelect(e) {
        const file = e.target.files[0];
        if (!file) return;

        resizeImage(file, function(base64Str) {
            uploadedGroupIconBase64 = base64Str;
            const preview = document.getElementById('volga-chat-group-icon-preview');
            if (preview) {
                preview.innerHTML = `<img src="${base64Str}" style="width:100%;height:100%;object-fit:cover;">`;
            }
        });
    }

    function resizeImage(file, callback) {
        const reader = new FileReader();
        reader.onload = function(event) {
            const img = new Image();
            img.onload = function() {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                canvas.width = 96;
                canvas.height = 96;
                ctx.drawImage(img, 0, 0, 96, 96);
                callback(canvas.toDataURL('image/jpeg', 0.8));
            };
            img.src = event.target.result;
        };
        reader.readAsDataURL(file);
    }

    async function createGroupChat() {
        const nameInput = document.getElementById('volga-chat-group-name');
        const groupName = nameInput.value.trim();
        if (!groupName) {
            alert('Please enter a group name.');
            return;
        }

        const checkboxes = document.querySelectorAll('.volga-chat-group-participant-checkbox:checked');
        if (checkboxes.length === 0) {
            alert('Please select at least one coworker.');
            return;
        }

        const participants = Array.from(checkboxes).map(cb => cb.value);
        participants.push(currentUserId); // Add self

        const groupId = `group_${Date.now()}`;
        const timestamp = new Date().toISOString();

        const initialSystemMessage = {
            senderId: 'system',
            senderName: 'System',
            text: `${currentUserDisplayName} created the group "${groupName}"`,
            timestamp: activeDb ? firebase.firestore.FieldValue.serverTimestamp() : timestamp
        };

        const initialMetadata = {
            isGroup: true,
            name: groupName,
            groupIcon: uploadedGroupIconBase64 || "",
            participants: participants,
            createdBy: currentUserId,
            lastMessage: initialSystemMessage.text,
            lastSenderId: 'system',
            lastUpdated: timestamp,
            unreadCount: {}
        };

        // Initialize unreads
        participants.forEach(pId => {
            initialMetadata.unreadCount[pId] = (pId !== currentUserId) ? 1 : 0;
        });

        if (activeDb) {
            try {
                // 1. Create chat document
                const chatRef = activeDb.collection('chats').doc(groupId);
                await chatRef.set(initialMetadata);

                // 2. Add initial system message
                const msgRef = chatRef.collection('messages').doc();
                await msgRef.set(initialSystemMessage);
            } catch(e) {
                console.error("Failed to create Firestore group chat:", e);
                alert("Failed to create group chat in database.");
                return;
            }
        } else {
            // Local Storage Mode
            try {
                // 1. Save metadata snippet
                loadLocalMetadata();
                chatMetadata[groupId] = initialMetadata;
                saveLocalMetadata();

                // 2. Save message
                const messagesKey = `volga_chat_messages_${groupId}`;
                localStorage.setItem(messagesKey, JSON.stringify([initialSystemMessage]));
            } catch(e) {
                console.error("Failed to create local group chat:", e);
                alert("Failed to create group chat locally.");
                return;
            }
        }

        closeGroupModal();

        // Refresh and open
        renderInboxList();
        openActiveChatWindow(groupId, groupName, 'group', true);
    }

    // Group Edit Modal Dialog Helpers
    function openEditGroupModal() {
        if (!activeChatIsGroup || !activeChatUserId) return;

        const modal = document.getElementById('volga-chat-group-edit-modal');
        const list = document.getElementById('volga-chat-group-edit-participants-list');
        if (!modal || !list) return;

        const meta = chatMetadata[activeChatUserId] || {};
        
        // Populate group name
        document.getElementById('volga-chat-group-edit-name').value = meta.name || '';

        // Reset file input value
        const editIconInput = document.getElementById('volga-chat-group-edit-icon-input');
        if (editIconInput) editIconInput.value = '';

        // Populate icon preview
        const preview = document.getElementById('volga-chat-group-edit-icon-preview');
        if (preview) {
            if (meta.groupIcon) {
                preview.innerHTML = `<img src="${meta.groupIcon}" style="width:100%;height:100%;object-fit:cover;">`;
            } else {
                const char = (meta.name || 'G').charAt(0).toUpperCase();
                preview.innerHTML = char;
            }
        }
        uploadedGroupIconBase64 = meta.groupIcon || '';

        // Populate checkboxes
        const currentParticipants = meta.participants || [];
        let html = '';
        usersList.forEach(u => {
            const isChecked = currentParticipants.includes(u.id) ? 'checked' : '';
            html += `
                <label class="volga-chat-group-participant-item">
                    <input type="checkbox" class="volga-chat-group-edit-participant-checkbox" value="${u.id}" ${isChecked}>
                    <span>${escapeHtml(u.displayName)}</span>
                </label>
            `;
        });
        list.innerHTML = html || '<div style="font-size:0.8rem;color:#94a3b8;padding:8px 0;text-align:center;">No coworkers available</div>';

        modal.style.display = 'flex';
    }

    function closeEditGroupModal() {
        const modal = document.getElementById('volga-chat-group-edit-modal');
        if (modal) modal.style.display = 'none';
        uploadedGroupIconBase64 = '';
    }

    function handleGroupEditIconSelect(e) {
        const file = e.target.files[0];
        if (!file) return;

        resizeImage(file, function(base64Str) {
            uploadedGroupIconBase64 = base64Str;
            const preview = document.getElementById('volga-chat-group-edit-icon-preview');
            if (preview) {
                preview.innerHTML = `<img src="${base64Str}" style="width:100%;height:100%;object-fit:cover;">`;
            }
        });
    }

    async function saveEditGroupChanges() {
        if (!activeChatIsGroup || !activeChatUserId) return;

        const nameInput = document.getElementById('volga-chat-group-edit-name');
        const groupName = nameInput.value.trim();
        if (!groupName) {
            alert('Please enter a group name.');
            return;
        }

        const checkboxes = document.querySelectorAll('.volga-chat-group-edit-participant-checkbox:checked');
        const participants = Array.from(checkboxes).map(cb => cb.value);
        participants.push(currentUserId); // Add self

        const timestamp = new Date().toISOString();
        const systemMsgText = `${currentUserDisplayName} updated the group details`;

        const updateSystemMessage = {
            senderId: 'system',
            senderName: 'System',
            text: systemMsgText,
            timestamp: activeDb ? firebase.firestore.FieldValue.serverTimestamp() : timestamp
        };

        if (activeDb) {
            try {
                const chatRef = activeDb.collection('chats').doc(activeChatUserId);
                
                await chatRef.update({
                    name: groupName,
                    groupIcon: uploadedGroupIconBase64 || "",
                    participants: participants,
                    lastMessage: systemMsgText,
                    lastSenderId: 'system',
                    lastUpdated: timestamp
                });

                // Add system message doc
                const msgRef = chatRef.collection('messages').doc();
                await msgRef.set(updateSystemMessage);
            } catch(e) {
                console.error("Failed to update Firestore group chat:", e);
                alert("Failed to save changes in database.");
                return;
            }
        } else {
            // Local Storage mode
            try {
                loadLocalMetadata();
                if (chatMetadata[activeChatUserId]) {
                    chatMetadata[activeChatUserId].name = groupName;
                    chatMetadata[activeChatUserId].groupIcon = uploadedGroupIconBase64 || "";
                    chatMetadata[activeChatUserId].participants = participants;
                    chatMetadata[activeChatUserId].lastMessage = systemMsgText;
                    chatMetadata[activeChatUserId].lastSenderId = 'system';
                    chatMetadata[activeChatUserId].lastUpdated = timestamp;
                }
                saveLocalMetadata();

                // Save system message
                const messagesKey = `volga_chat_messages_${activeChatUserId}`;
                const storedMsgs = localStorage.getItem(messagesKey);
                const messages = storedMsgs ? JSON.parse(storedMsgs) : [];
                messages.push(updateSystemMessage);
                localStorage.setItem(messagesKey, JSON.stringify(messages));
            } catch(e) {
                console.error("Failed to update local group chat:", e);
                alert("Failed to save changes locally.");
                return;
            }
        }

        closeEditGroupModal();

        // Refresh UI
        // Update header display info dynamically
        document.getElementById('volga-chat-window-title').textContent = groupName;
        document.getElementById('volga-chat-window-subtitle').textContent = `GROUP • ${participants.length} PARTICIPANTS`;
        
        const avatar = document.getElementById('volga-chat-window-avatar');
        if (uploadedGroupIconBase64) {
            avatar.innerHTML = `<img src="${uploadedGroupIconBase64}" alt="${groupName}" style="width:100%;height:100%;border-radius:50%;object-fit:cover;">`;
        } else {
            const char = groupName.charAt(0).toUpperCase();
            avatar.innerHTML = `<div style="width:100%;height:100%;background:#e0f2fe;color:#0369a1;display:flex;align-items:center;justify-content:center;font-weight:800;border-radius:50%;font-size:0.95rem;">${char}</div>`;
        }

        renderInboxList();
    }

    async function deleteGroupChat() {
        if (!activeChatIsGroup || !activeChatUserId) return;

        const confirmDelete = confirm("Are you sure you want to delete this group? All messages and metadata will be permanently lost.");
        if (!confirmDelete) return;

        const targetGroupId = activeChatUserId;

        if (activeDb) {
            try {
                // Delete messages collection documents first
                const chatRef = activeDb.collection('chats').doc(targetGroupId);
                const messagesSnapshot = await chatRef.collection('messages').get();
                const batch = activeDb.batch();
                
                messagesSnapshot.forEach(doc => {
                    batch.delete(doc.ref);
                });
                
                // Delete chat metadata doc
                batch.delete(chatRef);
                await batch.commit();
            } catch(e) {
                console.error("Failed to delete Firestore group chat:", e);
                alert("Failed to delete group from database.");
                return;
            }
        } else {
            // Local Storage mode
            try {
                loadLocalMetadata();
                delete chatMetadata[targetGroupId];
                saveLocalMetadata();

                // Delete messages list
                localStorage.removeItem(`volga_chat_messages_${targetGroupId}`);
            } catch(e) {
                console.error("Failed to delete local group chat:", e);
                alert("Failed to delete group locally.");
                return;
            }
        }

        closeEditGroupModal();
        closeActiveChatWindow(); // Close window, refresh inbox roster
    }

    // Reset unread count on open
    async function resetUnreadCount(targetUserId) {
        const chatId = getChatId(targetUserId);
        
        if (activeDb) {
            try {
                const ref = activeDb.collection('chats').doc(chatId);
                await activeDb.runTransaction(async transaction => {
                    const doc = await transaction.get(ref);
                    if (doc.exists) {
                        const currentUnreads = doc.data().unreadCount || {};
                        currentUnreads[currentUserId] = 0;
                        transaction.update(ref, { unreadCount: currentUnreads });
                    }
                });
            } catch(e) {
                console.error("Firestore unread reset transaction failed:", e);
            }
        } else {
            // Local fallback
            if (chatMetadata[chatId]) {
                if (!chatMetadata[chatId].unreadCount) chatMetadata[chatId].unreadCount = {};
                chatMetadata[chatId].unreadCount[currentUserId] = 0;
                saveLocalMetadata();
                renderInboxList();
            }
        }
    }

    // 9. Message Stream Logic
    function streamMessages(targetUserId) {
        const container = document.getElementById('volga-chat-messages');
        container.innerHTML = `<div style="text-align:center;padding:20px;color:#94a3b8;font-size:0.8rem;">Loading conversation...</div>`;

        const chatId = getChatId(targetUserId);

        if (activeDb) {
            // Live Firestore stream
            if (firestoreChatListener) firestoreChatListener();

            firestoreChatListener = activeDb.collection('chats').doc(chatId).collection('messages')
                .orderBy('timestamp', 'asc')
                .limitToLast(100)
                .onSnapshot(snapshot => {
                    const messages = [];
                    snapshot.forEach(doc => {
                        const data = doc.data();
                        data.id = doc.id;
                        messages.push(data);
                    });
                    renderMessages(messages);
                }, error => {
                    console.error("Firestore messages stream error:", error);
                    container.innerHTML = `<div style="text-align:center;padding:20px;color:#ef4444;font-size:0.8rem;">Failed to load messages.</div>`;
                });
        } else {
            // Local fallback stream
            streamLocalMessages();
        }
    }

    // Local Storage message render
    function streamLocalMessages() {
        const chatId = getChatId(activeChatUserId);
        try {
            const data = localStorage.getItem(`volga_chat_messages_${chatId}`);
            const messages = data ? JSON.parse(data) : [];
            renderMessages(messages);
        } catch(e) {
            console.error(e);
        }
    }

    // Render message bubbles in HTML container
    function renderMessages(messages) {
        const container = document.getElementById('volga-chat-messages');
        if (!container) return;

        if (messages.length === 0) {
            container.innerHTML = `<div class="volga-chat-msg-empty">No messages here yet. Say hello!</div>`;
            return;
        }

        let html = '';
        messages.forEach((msg, idx) => {
            const isMe = msg.senderId === currentUserId;
            
            // Render System Messages Centered
            if (msg.senderId === 'system') {
                html += `
                    <div style="text-align:center;color:#94a3b8;font-size:0.75rem;margin:8px 0;font-weight:600;font-style:italic;width:100%;">
                        ${escapeHtml(msg.text)}
                    </div>
                `;
                return;
            }

            let timeStr = '';
            if (msg.timestamp) {
                const date = msg.timestamp.toDate ? msg.timestamp.toDate() : new Date(msg.timestamp);
                timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            }

            // Check if the next message is from the same sender and sent within 3 minutes (180000ms)
            let isGrouped = false;
            const nextMsg = messages[idx + 1];
            if (nextMsg && nextMsg.senderId === msg.senderId && nextMsg.senderId !== 'system') {
                if (msg.timestamp && nextMsg.timestamp) {
                    const date = msg.timestamp.toDate ? msg.timestamp.toDate() : new Date(msg.timestamp);
                    const nextDate = nextMsg.timestamp.toDate ? nextMsg.timestamp.toDate() : new Date(nextMsg.timestamp);
                    const diffMs = Math.abs(nextDate.getTime() - date.getTime());
                    if (diffMs <= 180000) { // 3 minutes threshold
                        isGrouped = true;
                    }
                } else {
                    // Fallback: if either message has a pending/null timestamp, group them as consecutive
                    isGrouped = true;
                }
            }

            // Show sender display name for other users in a group chat (on the first message of a consecutive stack)
            const prevMsg = messages[idx - 1];
            const showSenderName = activeChatIsGroup && !isMe && (!prevMsg || prevMsg.senderId !== msg.senderId);

            const marginStyle = isGrouped ? 'margin-bottom: 2px;' : 'margin-bottom: 12px;';

            let bubbleContentHtml = escapeHtml(msg.text);
            if (msg.attachment) {
                const att = msg.attachment;
                if (att.type.startsWith('image/')) {
                    bubbleContentHtml = `
                        <div class="volga-chat-msg-attachment-img" style="margin-bottom:6px;max-width:100%;border-radius:6px;overflow:hidden;">
                            <img src="${att.data}" alt="${escapeHtml(att.name)}" style="width:100%;max-height:180px;object-fit:cover;border-radius:6px;display:block;">
                        </div>
                        <div style="font-size:0.65rem;font-weight:700;display:flex;align-items:center;gap:4px;opacity:0.8;">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                            <a href="${att.data}" download="${escapeHtml(att.name)}" style="color:inherit;text-decoration:none;">Download Image</a>
                        </div>
                    `;
                } else if (att.type === 'application/pdf') {
                    bubbleContentHtml = `
                        <div style="display:flex;align-items:center;gap:8px;background:rgba(255,255,255,0.15);padding:8px;border-radius:6px;margin-bottom:4px;border:1px solid rgba(0,0,0,0.05);color:inherit;">
                            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="color:#ef4444;flex-shrink:0;"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>
                            <div style="min-width:0;flex:1;text-align:left;">
                                <div style="font-size:0.72rem;font-weight:700;text-overflow:ellipsis;overflow:hidden;white-space:nowrap;line-height:1.2;">${escapeHtml(att.name)}</div>
                                <div style="font-size:0.58rem;opacity:0.7;">PDF Document</div>
                            </div>
                        </div>
                        <div style="font-size:0.65rem;font-weight:700;display:flex;align-items:center;gap:4px;opacity:0.8;margin-top:4px;">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>
                            <a href="${att.data}" download="${escapeHtml(att.name)}" style="color:inherit;text-decoration:none;">Download PDF</a>
                        </div>
                    `;
                }
            }

            html += `
                <div class="volga-chat-msg-bubble-row ${isMe ? 'me' : 'others'}" style="${marginStyle}" data-msg-id="${msg.id || ''}">
                    ${showSenderName ? `<div style="font-size:0.68rem;font-weight:700;color:var(--primary, #3b82f6);margin-bottom:2px;padding-left:4px;">${escapeHtml(msg.senderName)}</div>` : ''}
                    <div style="display:flex;align-items:center;gap:6px;width:100%;justify-content:${isMe ? 'flex-end' : 'flex-start'};">
                        ${isMe ? `
                            <div class="volga-chat-msg-actions-dropdown" style="display:none;background:#ffffff;border:1px solid #cbd5e1;box-shadow:0 2px 5px rgba(0,0,0,0.08);border-radius:6px;padding:4px;gap:4px;font-size:0.68rem;z-index:10;user-select:none;">
                                ${!msg.attachment ? `<span class="volga-chat-msg-action-edit" style="cursor:pointer;color:#3b82f6;font-weight:700;padding:2px 6px;border-radius:4px;transition:background 0.2s;" title="Edit message">Edit</span>` : ''}
                                <span class="volga-chat-msg-action-delete" style="cursor:pointer;color:#ef4444;font-weight:700;padding:2px 6px;border-radius:4px;transition:background 0.2s;" title="Delete message">Delete</span>
                            </div>
                        ` : ''}
                        
                        <div class="volga-chat-msg-bubble" style="${isMe ? 'cursor:pointer;' : ''}">
                            ${bubbleContentHtml}
                            ${msg.edited ? `<span style="font-size:0.6rem;opacity:0.6;font-style:italic;margin-left:4px;display:inline-block;">(edited)</span>` : ''}
                        </div>
                    </div>
                    ${isGrouped ? '' : `<div class="volga-chat-msg-time">${timeStr}</div>`}
                </div>
            `;
        });

        container.innerHTML = html;
        container.scrollTop = container.scrollHeight; // Scroll to bottom

        // Add event listeners to bubbles and edit/delete actions
        container.querySelectorAll('.volga-chat-msg-bubble-row.me').forEach(row => {
            const bubble = row.querySelector('.volga-chat-msg-bubble');
            const dropdown = row.querySelector('.volga-chat-msg-actions-dropdown');
            const editBtn = row.querySelector('.volga-chat-msg-action-edit');
            const deleteBtn = row.querySelector('.volga-chat-msg-action-delete');
            const msgId = row.getAttribute('data-msg-id');

            if (!msgId || !bubble || !dropdown || !deleteBtn) return;

            // Toggle actions dropdown on bubble click
            bubble.addEventListener('click', (e) => {
                e.stopPropagation();
                // Close any other open dropdowns first
                document.querySelectorAll('.volga-chat-msg-actions-dropdown').forEach(d => {
                    if (d !== dropdown) d.style.display = 'none';
                });
                dropdown.style.display = dropdown.style.display === 'flex' ? 'none' : 'flex';
            });

            // Handle edit button click
            if (editBtn) {
                editBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    dropdown.style.display = 'none';
                    
                    // Get current text
                    const originalText = bubble.innerText.replace(/\s*\(edited\)$/, '');
                    
                    // Replace bubble HTML with edit panel
                    bubble.style.cursor = 'default';
                    bubble.innerHTML = `
                        <div class="volga-chat-msg-edit-panel" style="display:flex;flex-direction:column;gap:6px;width:100%;min-width:160px;margin-top:2px;">
                            <textarea class="volga-chat-msg-edit-input" style="width:100%;font-size:0.8rem;padding:4px;border-radius:6px;border:1px solid #cbd5e1;resize:none;font-family:inherit;min-height:40px;color:#334155;">${originalText}</textarea>
                            <div style="display:flex;justify-content:flex-end;gap:4px;margin-top:2px;">
                                <button class="volga-chat-msg-edit-btn cancel" style="font-size:0.65rem;padding:2px 6px;border-radius:4px;border:none;background:#e2e8f0;cursor:pointer;font-weight:600;color:#475569;">Cancel</button>
                                <button class="volga-chat-msg-edit-btn save" style="font-size:0.65rem;padding:2px 6px;border-radius:4px;border:none;background:#3b82f6;color:white;cursor:pointer;font-weight:700;">Save</button>
                            </div>
                        </div>
                    `;

                    // Handle cancel edit
                    bubble.querySelector('.volga-chat-msg-edit-btn.cancel').addEventListener('click', (ev) => {
                        ev.stopPropagation();
                        // Restore original message rendering
                        streamMessages(activeChatUserId);
                    });

                    // Handle save edit
                    bubble.querySelector('.volga-chat-msg-edit-btn.save').addEventListener('click', async (ev) => {
                        ev.stopPropagation();
                        const newText = bubble.querySelector('.volga-chat-msg-edit-input').value.trim();
                        if (!newText) return;
                        await updateMessageText(msgId, newText);
                    });
                });
            }

            // Handle delete button click
            deleteBtn.addEventListener('click', async (e) => {
                e.stopPropagation();
                dropdown.style.display = 'none';
                
                const msgObj = messages.find(m => m.id === msgId);
                const isMedia = msgObj && msgObj.attachment;

                if (isMedia) {
                    showCustomConfirm("Delete this attachment permanently?", async () => {
                        await removeMessage(msgId);
                    });
                } else {
                    await removeMessage(msgId);
                }
            });
        });

        // Close dropdowns if clicking anywhere else
        const documentClickHandler = () => {
            document.querySelectorAll('.volga-chat-msg-actions-dropdown').forEach(d => {
                d.style.display = 'none';
            });
        };
        document.removeEventListener('click', documentClickHandler);
        document.addEventListener('click', documentClickHandler);
    }

    async function updateMessageText(msgId, newText) {
        const chatId = getChatId(activeChatUserId);
        
        if (activeDb) {
            try {
                const msgRef = activeDb.collection('chats').doc(chatId).collection('messages').doc(msgId);
                await msgRef.update({
                    text: newText,
                    edited: true
                });
            } catch(e) {
                console.error("Failed to update message in Firestore:", e);
            }
        } else {
            // Local Storage Mode
            try {
                const messagesKey = `volga_chat_messages_${chatId}`;
                const storedMsgs = localStorage.getItem(messagesKey);
                if (storedMsgs) {
                    const messages = JSON.parse(storedMsgs);
                    const msg = messages.find(m => m.id === msgId);
                    if (msg) {
                        msg.text = newText;
                        msg.edited = true;
                        localStorage.setItem(messagesKey, JSON.stringify(messages));
                        streamLocalMessages();
                    }
                }
            } catch(e) {
                console.error("Failed to update message locally:", e);
            }
        }
    }

    async function removeMessage(msgId) {
        const chatId = getChatId(activeChatUserId);

        if (activeDb) {
            try {
                const msgRef = activeDb.collection('chats').doc(chatId).collection('messages').doc(msgId);
                await msgRef.delete();
            } catch(e) {
                console.error("Failed to delete message in Firestore:", e);
            }
        } else {
            // Local Storage Mode
            try {
                const messagesKey = `volga_chat_messages_${chatId}`;
                const storedMsgs = localStorage.getItem(messagesKey);
                if (storedMsgs) {
                    let messages = JSON.parse(storedMsgs);
                    messages = messages.filter(m => m.id !== msgId);
                    localStorage.setItem(messagesKey, JSON.stringify(messages));
                    streamLocalMessages();
                }
            } catch(e) {
                console.error("Failed to delete message locally:", e);
            }
        }
    }

    function handleFileAttachment(e) {
        const file = e.target.files[0];
        if (!file) return;

        const maxFileSize = 100 * 1024; // 100 KB limit for inline base64 messages
        const reader = new FileReader();

        if (file.type.startsWith('image/')) {
            // Compress and resize image
            resizeChatImage(file, function(compressedBase64) {
                sendAttachment(file.name, file.type, compressedBase64);
            });
        } else {
            // PDF/Document check size
            if (file.size > maxFileSize) {
                showCustomAlert("File size must be under 100 KB.");
                e.target.value = '';
                return;
            }
            reader.onload = function(event) {
                sendAttachment(file.name, file.type, event.target.result);
            };
            reader.readAsDataURL(file);
        }
        e.target.value = ''; // Reset file input
    }

    function resizeChatImage(file, callback) {
        const reader = new FileReader();
        reader.onload = function(event) {
            const img = new Image();
            img.onload = function() {
                const canvas = document.createElement('canvas');
                const ctx = canvas.getContext('2d');
                // Target width: 400px max, maintain aspect ratio
                let width = img.width;
                let height = img.height;
                if (width > 400) {
                    height = Math.round((height * 400) / width);
                    width = 400;
                }
                canvas.width = width;
                canvas.height = height;
                ctx.drawImage(img, 0, 0, width, height);
                callback(canvas.toDataURL('image/jpeg', 0.75)); // 75% quality
            };
            img.src = event.target.result;
        };
        reader.readAsDataURL(file);
    }

    async function sendAttachment(fileName, fileType, base64Data) {
        if (!activeChatUserId) return;
        
        const chatId = getChatId(activeChatUserId);
        const timestamp = new Date().toISOString();
        
        const msgPayload = {
            senderId: currentUserId,
            senderName: currentUserDisplayName,
            text: `[Attachment: ${fileName}]`,
            attachment: {
                name: fileName,
                type: fileType,
                data: base64Data
            }
        };

        if (activeDb) {
            try {
                // 1. Save document
                const chatRef = activeDb.collection('chats').doc(chatId);
                const msgRef = chatRef.collection('messages').doc();
                msgPayload.timestamp = firebase.firestore.FieldValue.serverTimestamp();
                await msgRef.set(msgPayload);

                // 2. Update metadata
                const doc = await chatRef.get();
                let currentUnreads = {};
                let participants = [currentUserId, activeChatUserId];
                let isGroup = false;
                let groupName = '';

                if (doc.exists) {
                    const data = doc.data();
                    currentUnreads = data.unreadCount || {};
                    participants = data.participants || participants;
                    isGroup = data.isGroup || false;
                    groupName = data.name || '';
                }

                participants.forEach(pId => {
                    if (pId !== currentUserId) {
                        currentUnreads[pId] = (currentUnreads[pId] || 0) + 1;
                    }
                });

                const updatePayload = {
                    participants: participants,
                    lastMessage: `📷 Shared a file: ${fileName}`,
                    lastSenderId: currentUserId,
                    lastUpdated: timestamp,
                    unreadCount: currentUnreads
                };

                if (isGroup) {
                    updatePayload.isGroup = true;
                    updatePayload.name = groupName;
                }

                await chatRef.set(updatePayload, { merge: true });
            } catch(e) {
                console.error("Firestore attachment send failed:", e);
            }
        } else {
            // Local storage Mode
            try {
                const messagesKey = `volga_chat_messages_${chatId}`;
                const storedMsgs = localStorage.getItem(messagesKey);
                const messages = storedMsgs ? JSON.parse(storedMsgs) : [];
                msgPayload.id = `msg_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
                msgPayload.timestamp = timestamp;
                
                messages.push(msgPayload);
                localStorage.setItem(messagesKey, JSON.stringify(messages));

                loadLocalMetadata();
                const meta = chatMetadata[chatId] || {
                    participants: [currentUserId, activeChatUserId],
                    unreadCount: {}
                };
                meta.lastMessage = `📷 Shared a file: ${fileName}`;
                meta.lastSenderId = currentUserId;
                meta.lastUpdated = timestamp;
                if (!meta.unreadCount) meta.unreadCount = {};
                meta.participants.forEach(pId => {
                    if (pId !== currentUserId) {
                        meta.unreadCount[pId] = (meta.unreadCount[pId] || 0) + 1;
                    }
                });
                chatMetadata[chatId] = meta;
                saveLocalMetadata();
                streamLocalMessages();
            } catch(e) {
                console.error("Local storage attachment send failed:", e);
            }
        }
    }

    // 10. Message Sending Logic
    async function sendMessage() {
        const input = document.getElementById('volga-chat-input');
        const text = input.value.trim();
        if (!text || !activeChatUserId) return;

        input.value = ''; // Reset input field

        const chatId = getChatId(activeChatUserId);
        const timestamp = new Date().toISOString();

        if (activeDb) {
            try {
                // 1. Add message document
                const chatRef = activeDb.collection('chats').doc(chatId);
                const msgRef = chatRef.collection('messages').doc();
                
                await msgRef.set({
                    senderId: currentUserId,
                    senderName: currentUserDisplayName,
                    text: text,
                    timestamp: firebase.firestore.FieldValue.serverTimestamp()
                });

                // 2. Update chat session metadata
                const doc = await chatRef.get();
                let currentUnreads = {};
                let participants = [currentUserId, activeChatUserId];
                let isGroup = false;
                let groupName = '';

                if (doc.exists) {
                    const data = doc.data();
                    currentUnreads = data.unreadCount || {};
                    participants = data.participants || participants;
                    isGroup = data.isGroup || false;
                    groupName = data.name || '';
                }

                // Increment unreads for everyone else
                participants.forEach(pId => {
                    if (pId !== currentUserId) {
                        currentUnreads[pId] = (currentUnreads[pId] || 0) + 1;
                    }
                });

                const updatePayload = {
                    participants: participants,
                    lastMessage: text,
                    lastSenderId: currentUserId,
                    lastUpdated: new Date().toISOString(),
                    unreadCount: currentUnreads
                };

                if (isGroup) {
                    updatePayload.isGroup = true;
                    updatePayload.name = groupName;
                }

                await chatRef.set(updatePayload, { merge: true });

            } catch (e) {
                console.error("Firestore message send failed:", e);
            }
        } else {
            // Local Storage fallback mode
            try {
                // 1. Save Message
                const messagesKey = `volga_chat_messages_${chatId}`;
                const storedMsgs = localStorage.getItem(messagesKey);
                const messages = storedMsgs ? JSON.parse(storedMsgs) : [];
                
                messages.push({
                    id: `msg_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
                    senderId: currentUserId,
                    senderName: currentUserDisplayName,
                    text: text,
                    timestamp: timestamp
                });
                localStorage.setItem(messagesKey, JSON.stringify(messages));

                // 2. Save Metadata snippet
                loadLocalMetadata();
                const meta = chatMetadata[chatId] || {
                    participants: [currentUserId, activeChatUserId],
                    unreadCount: {}
                };
                
                meta.lastMessage = text;
                meta.lastSenderId = currentUserId;
                meta.lastUpdated = timestamp;
                
                if (!meta.unreadCount) meta.unreadCount = {};
                meta.participants.forEach(pId => {
                    if (pId !== currentUserId) {
                        meta.unreadCount[pId] = (meta.unreadCount[pId] || 0) + 1;
                    }
                });
                
                chatMetadata[chatId] = meta;
                saveLocalMetadata();
                streamLocalMessages();
            } catch(e) {
                console.error("Local storage send failed:", e);
            }
        }
    }

    // 11. Event Handlers
    function handleSendClick() {
        sendMessage();
    }

    // Prevent submission on Shift+Enter, submit on Enter
    function handleInputKeydown(e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    }

    function handleSearchInput(e) {
        const filterVal = e.target.value;
        renderInboxList(filterVal);
    }

    // Sanitization Helper
    function escapeHtml(str) {
        if (!str) return '';
        return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    }

    // 12. Run Inject on Page Load
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', injectChatUI);
    } else {
        injectChatUI();
    }

})();
