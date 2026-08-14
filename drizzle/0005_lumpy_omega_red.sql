DROP INDEX `invoices_contract_period_unq`;--> statement-breakpoint
CREATE UNIQUE INDEX `invoices_contract_period_unq` ON `invoices` (`contract_id`,`period`) WHERE "invoices"."status" != 'cancelled';