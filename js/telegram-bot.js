const ORDER_STATUSES = {
    PENDING: 'Pending',
    CONFIRMED: 'Confirmed', 
    SHIPPED: 'Shipped',
    DELIVERED: 'Delivered',
    CANCELLED: 'Cancelled'
};

const TelegramBot = {
    BOT_TOKEN: '8942682982:AAEP-jQlalHJ3dYcOKvBvXn8wfcl9z_Ockw',
    CHAT_IDS: {
        ADMIN: '1299401914', // Main admin with full permissions
        VIEWERS: [           // Array of viewer chat IDs - view only
            '6272116305',
            '1111111111',     // Add more viewer IDs here
        ]
    },
    POLL_INTERVAL: 2000, // Poll every 2 seconds
    lastUpdateId: 0,
    isOnline: false,
    pollingInterval: null,

    init: async function() {
        console.log('Initializing Telegram bot...');
        await this.checkConnection();
        
        // Check connection periodically
        setInterval(() => this.checkConnection(), 10000);
        
        if (this.isOnline) {
            this.startPolling();
        }
    },

    checkConnection: async function() {
        try {
            const response = await fetch('https://api.telegram.org/bot' + this.BOT_TOKEN + '/getMe', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });
            
            this.isOnline = response.ok;
            console.log('Bot connection status:', this.isOnline ? 'Online' : 'Offline');
            
            return this.isOnline;
        } catch (error) {
            console.log('Bot is offline:', error);
            this.isOnline = false;
            return false;
        }
    },

    startPolling: function() {
        if (this.pollingInterval) {
            clearInterval(this.pollingInterval);
        }
        
        console.log('Starting to poll for updates...');
        this.pollingInterval = setInterval(async () => {
            if (this.isOnline) {
                await this.getUpdates();
            }
        }, this.POLL_INTERVAL);
    },

    getUpdates: async function() {
        const url = `https://api.telegram.org/bot${this.BOT_TOKEN}/getUpdates?offset=${this.lastUpdateId + 1}`;
        try {
            const response = await fetch(url);
            const data = await response.json();

            if (data.ok && data.result.length > 0) {
                data.result.forEach(update => {
                    this.lastUpdateId = update.update_id;
                    if (update.message && update.message.text) {
                        this.handleMessage(update.message);
                    } else if (update.callback_query) {
                        this.handleCallbackQuery(update.callback_query);
                    }
                });
            }
        } catch (error) {
            console.error('Error polling updates:', error);
        }
    },

    handleMessage: async function(message) {
        const text = message.text.toLowerCase();
        const args = text.split(' ');
        
        if (text.startsWith('/status')) {
            await this.handleStatusCommand(args);
        } else if (text.startsWith('/help')) {
            await this.sendMessage(this.getHelpMessage());
        }
    },

    sendMessage: async function(message) {
        if (!this.isOnline) {
            console.log('Bot is offline, storing message for later:', message);
            this.storeOfflineMessage(message);
            return false;
        }

        try {
            // Send to admin first
            await this.sendMessageToUser(this.CHAT_IDS.ADMIN, message);
            
            // Then send to all viewers
            for (const viewerId of this.CHAT_IDS.VIEWERS) {
                await this.sendMessageToUser(viewerId, message);
            }
            return true;
        } catch (error) {
            console.error('Failed to send Telegram message:', error);
            return false;
        }
    },

    sendMessageToUser: async function(chatId, message) {
        try {
            const response = await fetch(`https://api.telegram.org/bot${this.BOT_TOKEN}/sendMessage`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    chat_id: chatId,
                    text: message,
                    parse_mode: 'HTML',
                    disable_web_page_preview: true
                })
            });

            if (!response.ok) {
                console.error('Telegram API Error for chat ID:', chatId);
            }
        } catch (error) {
            console.error(`Failed to send message to ${chatId}:`, error);
        }
    },

    storeOfflineMessage: function(message) {
        const pendingMessages = JSON.parse(localStorage.getItem('pendingBotMessages') || '[]');
        pendingMessages.push({
            message: message,
            timestamp: new Date().toISOString()
        });
        localStorage.setItem('pendingBotMessages', JSON.stringify(pendingMessages));
    },

    sendPendingMessages: async function() {
        if (!this.isOnline) return;

        const pendingMessages = JSON.parse(localStorage.getItem('pendingBotMessages') || '[]');
        if (pendingMessages.length === 0) return;

        console.log('Sending pending messages:', pendingMessages.length);
        
        for (const item of pendingMessages) {
            await this.sendMessage(item.message);
        }

        localStorage.removeItem('pendingBotMessages');
    },

    sendStatusUpdate: async function(orderId, newStatus) {
        const order = StorageUtil.getOrderById(orderId);
        if (!order) return;

        const message = `
🔄 Order Status Update
------------------
🆔 Order ID: ${orderId}
👤 Customer: ${order.customer.name}
📞 Phone: ${order.customer.phone}
📍 Complete Address:
${order.customer.address}
${order.customer.city}, ${order.customer.state}
PIN: ${order.customer.pincode}

🛒 Order Details:
${order.items.map(item => `• ${item.name} ${item.size ? `(Size: ${item.size})` : ''} x${item.quantity} - ₹${(item.price * item.quantity).toFixed(2)}`).join('\n')}

📊 Previous Status: ${order.status}
📊 New Status: ${newStatus}
⏰ Updated at: ${new Date().toLocaleString()}
------------------`;

        return await this.sendMessage(message);
    },

    sendOrderNotification: async function(order) {
        const message = `
🛍️ New Order Received!
------------------
🆔 Order ID: ${order.orderId}
👤 Customer: ${order.customer.name}
📞 Phone: ${order.customer.phone}

💳 Payment Method: ${order.paymentMethod.toUpperCase()}
💵 Total Amount: ₹${order.total.toFixed(2)}
📊 Status: ${order.status}`;

        try {
            // Send to admin with buttons
            await fetch(`https://api.telegram.org/bot${this.BOT_TOKEN}/sendMessage`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    chat_id: this.CHAT_IDS.ADMIN,
                    text: message,
                    parse_mode: 'HTML',
                    reply_markup: {
                        inline_keyboard: [
                            [
                                { text: "✅ Confirm", callback_data: `confirm_${order.orderId}` },
                                { text: "🚚 Ship", callback_data: `ship_${order.orderId}` }
                            ],
                            [
                                { text: "📦 Deliver", callback_data: `deliver_${order.orderId}` },
                                { text: "❌ Cancel", callback_data: `cancel_${order.orderId}` }
                            ]
                        ]
                    }
                })
            });

            // Send to all viewers without buttons
            for (const viewerId of this.CHAT_IDS.VIEWERS) {
                await fetch(`https://api.telegram.org/bot${this.BOT_TOKEN}/sendMessage`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        chat_id: viewerId,
                        text: message,
                        parse_mode: 'HTML'
                    })
                });
            }

            return true;
        } catch (error) {
            console.error('Failed to send order notification:', error);
            return false;
        }
    },

    updateOrderStatus: async function(orderId, newStatus) {
        // Validate status
        if (!Object.values(ORDER_STATUSES).includes(newStatus)) {
            console.error('Invalid order status:', newStatus);
            return false;
        }

        // Update in local storage
        const updated = StorageUtil.updateOrderStatus(orderId, newStatus);
        if (!updated) {
            console.error('Failed to update order status in storage');
            return false;
        }

        // Send notification
        await this.sendStatusUpdate(orderId, newStatus);

        // Dispatch event for UI update
        window.dispatchEvent(new CustomEvent('orderStatusUpdated', { 
            detail: { orderId, status: newStatus }
        }));

        return true;
    },

    handleCallbackQuery: async function(callbackQuery) {
        // Only allow main admin to update status
        if (callbackQuery.message.chat.id.toString() !== this.CHAT_IDS.ADMIN) {
            return false;
        }

        const [action, orderId] = callbackQuery.data.split('_');
        let newStatus;

        switch(action.toLowerCase()) {
            case 'confirm':
                newStatus = ORDER_STATUSES.CONFIRMED;
                break;
            case 'ship':
                newStatus = ORDER_STATUSES.SHIPPED;
                break;
            case 'deliver':
                newStatus = ORDER_STATUSES.DELIVERED;
                break;
            case 'cancel':
                newStatus = ORDER_STATUSES.CANCELLED;
                break;
            default:
                return false;
        }

        return await this.updateOrderStatus(orderId, newStatus);
    },

    VALID_STATUSES: {
        PENDING: 'Pending',
        CONFIRMED: 'Confirmed',
        SHIPPED: 'Shipped',
        DELIVERED: 'Delivered',
        CANCELLED: 'Cancelled'
    },

    handleBotCommand: async function(message) {
        try {
            const text = message.text?.toLowerCase() || '';
            const args = text.split(/\s+/);
            const command = args[0];

            if (!command.startsWith('/')) {
                return false;
            }

            switch(command) {
                case '/status':
                    return await this.handleStatusCommand(args);
                case '/help':
                    return await this.handleHelpCommand();
                default:
                    return await this.sendMessage('Unknown command. Type /help for available commands.');
            }
        } catch (error) {
            console.error('Error handling command:', error);
            return await this.sendMessage('Error processing command. Please try again.');
        }
    },

    handleStatusCommand: async function(args) {
        if (args.length !== 3) {
            return await this.sendMessage(
                'Usage: /status [orderID] [status]\n' +
                'Valid statuses: ' + Object.values(this.VALID_STATUSES).join(', ')
            );
        }

        const orderId = args[1];
        const newStatus = args[2].toUpperCase();

        // Validate status
        if (!this.VALID_STATUSES[newStatus]) {
            return await this.sendMessage(
                'Invalid status. Valid statuses are:\n' + 
                Object.values(this.VALID_STATUSES).join(', ')
            );
        }

        // Get order
        const order = StorageUtil.getOrderById(orderId);
        if (!order) {
            return await this.sendMessage(`Order ${orderId} not found`);
        }

        // Update status
        const updated = StorageUtil.updateOrderStatus(orderId, this.VALID_STATUSES[newStatus]);
        if (updated) {
            // Send notifications
            await this.sendStatusUpdate(orderId, this.VALID_STATUSES[newStatus]);
            
            // Dispatch event for UI update
            window.dispatchEvent(new CustomEvent('orderStatusUpdated', {
                detail: { 
                    orderId: orderId, 
                    status: this.VALID_STATUSES[newStatus] 
                }
            }));

            return await this.sendMessage(`✅ Order ${orderId} status updated to ${this.VALID_STATUSES[newStatus]}`);
        } else {
            return await this.sendMessage(`❌ Failed to update order ${orderId}`);
        }
    },

    handleHelpCommand: async function() {
        const helpText = `
Available Commands:
------------------
/status [orderID] [status] - Update order status
/help - Show this help message

Valid Statuses: ${Object.values(this.VALID_STATUSES).join(', ')}

Example:
/status ORDER123 CONFIRMED`;

        return await this.sendMessage(helpText);
    },

    getHelpMessage: function() {
        return `
Available Commands:
------------------
/status [orderID] [status] - Update order status
/help - Show this help message

Valid Statuses: ${Object.values(this.VALID_STATUSES).join(', ')}

Example:
/status ORDER123 CONFIRMED`;
    }
};

// Initialize the bot when the page loads
document.addEventListener('DOMContentLoaded', async () => {
    await TelegramBot.init();
    
    // Listen for online status
    window.addEventListener('online', async () => {
        console.log('Browser is online');
        await TelegramBot.checkConnection();
        if (TelegramBot.isOnline) {
            await TelegramBot.sendPendingMessages();
        }
    });
    
    window.addEventListener('offline', () => {
        console.log('Browser is offline');
        TelegramBot.isOnline = false;
    });
});
