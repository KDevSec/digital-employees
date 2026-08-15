from enum import StrEnum


class InvalidTransition(ValueError):
    pass


class EnrollmentStatus(StrEnum):
    PENDING_REVIEW = "PENDING_REVIEW"
    APPROVED = "APPROVED"
    COMPLETED = "COMPLETED"
    REJECTED = "REJECTED"
    EXPIRED = "EXPIRED"
    CANCELLED = "CANCELLED"


class PackageStatus(StrEnum):
    DRAFT = "DRAFT"
    PUBLISHED = "PUBLISHED"
    WITHDRAWN = "WITHDRAWN"


ENROLLMENT_TRANSITIONS = {
    EnrollmentStatus.PENDING_REVIEW: frozenset(
        {
            EnrollmentStatus.APPROVED,
            EnrollmentStatus.REJECTED,
            EnrollmentStatus.EXPIRED,
            EnrollmentStatus.CANCELLED,
        }
    ),
    EnrollmentStatus.APPROVED: frozenset(
        {
            EnrollmentStatus.COMPLETED,
            EnrollmentStatus.EXPIRED,
            EnrollmentStatus.CANCELLED,
        }
    ),
}

PACKAGE_TRANSITIONS = {
    PackageStatus.DRAFT: frozenset({PackageStatus.PUBLISHED}),
    PackageStatus.PUBLISHED: frozenset({PackageStatus.WITHDRAWN}),
}


def transition_enrollment(current: EnrollmentStatus, target: EnrollmentStatus) -> EnrollmentStatus:
    if target not in ENROLLMENT_TRANSITIONS.get(current, frozenset()):
        raise InvalidTransition(f"cannot transition enrollment from {current} to {target}")
    return target


def transition_package(current: PackageStatus, target: PackageStatus) -> PackageStatus:
    if target not in PACKAGE_TRANSITIONS.get(current, frozenset()):
        raise InvalidTransition(f"cannot transition package from {current} to {target}")
    return target
