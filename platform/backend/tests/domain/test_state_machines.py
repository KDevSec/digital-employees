import pytest

from app.domain.states import (
    EnrollmentStatus,
    InvalidTransition,
    PackageStatus,
    transition_enrollment,
    transition_package,
)


@pytest.mark.parametrize(
    ("current", "target"),
    [
        (EnrollmentStatus.PENDING_REVIEW, EnrollmentStatus.APPROVED),
        (EnrollmentStatus.PENDING_REVIEW, EnrollmentStatus.REJECTED),
        (EnrollmentStatus.APPROVED, EnrollmentStatus.COMPLETED),
        (EnrollmentStatus.APPROVED, EnrollmentStatus.EXPIRED),
        (EnrollmentStatus.PENDING_REVIEW, EnrollmentStatus.CANCELLED),
    ],
)
def test_valid_enrollment_transitions(current: EnrollmentStatus, target: EnrollmentStatus) -> None:
    assert transition_enrollment(current, target) is target


@pytest.mark.parametrize(
    ("current", "target"),
    [
        (EnrollmentStatus.PENDING_REVIEW, EnrollmentStatus.COMPLETED),
        (EnrollmentStatus.REJECTED, EnrollmentStatus.APPROVED),
        (EnrollmentStatus.COMPLETED, EnrollmentStatus.APPROVED),
    ],
)
def test_invalid_enrollment_transitions_are_rejected(current: EnrollmentStatus, target: EnrollmentStatus) -> None:
    with pytest.raises(InvalidTransition):
        transition_enrollment(current, target)


def test_package_lifecycle_is_one_way() -> None:
    assert transition_package(PackageStatus.DRAFT, PackageStatus.PUBLISHED) is PackageStatus.PUBLISHED
    assert transition_package(PackageStatus.PUBLISHED, PackageStatus.WITHDRAWN) is PackageStatus.WITHDRAWN

    with pytest.raises(InvalidTransition):
        transition_package(PackageStatus.WITHDRAWN, PackageStatus.PUBLISHED)
