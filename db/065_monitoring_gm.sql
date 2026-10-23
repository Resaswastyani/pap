-- Top Management: menu Monitoring (performa perusahaan, performa divisi, plan monitoring & koordinasi, KPI)
INSERT IGNORE INTO division_menus (division_id, menu_key) SELECT d.id, 'monitoring' FROM divisions d WHERE d.code = 'general_manager';
