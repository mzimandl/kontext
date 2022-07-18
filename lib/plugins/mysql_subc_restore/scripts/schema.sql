DROP TABLE IF EXISTS kontext_subc_archive;

CREATE TABLE kontext_subc_archive (
  id INTEGER PRIMARY KEY AUTO_INCREMENT,
  user_id INTEGER NOT NULL,
  corpname TEXT NOT NULL,
  subcname TEXT NOT NULL,
  cql TEXT,
  `within` TEXT,
  text_types TEXT,
  timestamp TIMESTAMP NOT NULL
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_general_ci;