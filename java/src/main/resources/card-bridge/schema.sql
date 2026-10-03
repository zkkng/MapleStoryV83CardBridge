CREATE TABLE IF NOT EXISTS card_bridge_codes (
 issuance_id CHAR(36) PRIMARY KEY,
 code_hash CHAR(64) NOT NULL UNIQUE,
 account_id INT NOT NULL,
 item_id INT NOT NULL,
 quantity SMALLINT NOT NULL,
 pet_days INT NOT NULL DEFAULT 0,
 state VARCHAR(10) NOT NULL DEFAULT 'READY',
 claim_session CHAR(36),
 claim_character INT,
 receipt_id CHAR(36),
 used_at BIGINT,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 INDEX card_bridge_owner(account_id,state)
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS card_bridge_payments (
 order_id CHAR(64) PRIMARY KEY,
 account_id INT NOT NULL,
 cash_type INT NOT NULL DEFAULT 1,
 amount INT NOT NULL,
 balance_after INT NOT NULL,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB;
CREATE TABLE IF NOT EXISTS card_bridge_outbox (
 receipt_id CHAR(36) PRIMARY KEY,
 payload TEXT NOT NULL,
 delivered BOOLEAN NOT NULL DEFAULT FALSE,
 created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
 INDEX card_bridge_delivery(delivered,created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS card_bridge_sessions (
 token_hash CHAR(64) PRIMARY KEY,
 account_id INT NOT NULL,
 expires_at BIGINT NOT NULL,
 INDEX card_bridge_session_expiry(expires_at)
) ENGINE=InnoDB;
