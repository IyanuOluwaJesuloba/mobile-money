variable "project" {
  description = "Project name for resource naming"
  type        = string
}

variable "environment" {
  description = "Environment name (production, staging, development)"
  type        = string
}

variable "backup_retention_days" {
  description = "Number of days to retain backups (lifecycle policy)"
  type        = number
  default     = 30
}

variable "ecs_task_role_name" {
  description = "ECS task IAM role name (for backup service permissions)"
  type        = string
}

variable "alarm_topic_arn" {
  description = "SNS topic ARN for CloudWatch alarms"
  type        = string
  default     = ""
}
