CREATE TABLE `holdings` (
	`owner_id` text NOT NULL,
	`symbol` text NOT NULL,
	`purchased_on` text NOT NULL,
	`price` text,
	PRIMARY KEY(`owner_id`, `symbol`)
);
