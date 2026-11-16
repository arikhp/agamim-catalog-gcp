output "site_url" { value = "https://${local.domain}" }
output "site_bucket" { value = google_storage_bucket.site.name }
output "url_map" { value = google_compute_url_map.site.name }
output "ip_address" { value = google_compute_global_address.site.address }
